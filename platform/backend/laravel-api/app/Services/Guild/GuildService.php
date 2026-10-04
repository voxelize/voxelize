<?php

namespace App\Services\Guild;

use App\Models\Guild;
use App\Models\GuildInvite;
use App\Models\GuildMember;
use App\Models\Land;
use App\Models\LedgerTransaction;
use App\Models\User;
use App\Services\Audit\AuditLogger;
use App\Services\Economy\LedgerService;
use App\Services\Economy\Leg;
use App\Services\Economy\Posting;
use App\Services\Market\MarketException;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Guilds: one per player; the leader runs it, officers invite, kick
 * members and spend the treasury; every member may deposit. The treasury
 * is a ledger account, so every Crown in or out is a balanced transaction.
 */
class GuildService
{
    public function __construct(
        private readonly LedgerService $ledger,
        private readonly AuditLogger $audit,
    ) {}

    private function currency(): string
    {
        return (string) config('platform.economy.soft_currency');
    }

    public function create(User $leader, string $name, string $tag, string $key): Guild
    {
        if ($existing = Guild::query()->where('leader_id', $leader->id)->where('create_key', $key)->first()) {
            $existing->wasReplayed = true;

            return $existing;
        }
        $name = trim($name);
        $tag = strtoupper(trim($tag));
        if (mb_strlen($name) < 3 || mb_strlen($name) > 32 || ! preg_match('/^[\pL\pN _-]+$/u', $name)) {
            throw new MarketException('bad_name', 'A guild name is 3-32 letters, digits, spaces, _ or -.');
        }
        if (! preg_match('/^[A-Z0-9]{2,5}$/', $tag)) {
            throw new MarketException('bad_tag', 'A tag is 2-5 letters or digits.');
        }
        if (GuildMember::query()->where('user_id', $leader->id)->exists()) {
            throw new MarketException('in_guild', 'Leave your guild first.', 409);
        }
        if (Guild::query()->where('name', $name)->orWhere('tag', $tag)->exists()) {
            throw new MarketException('guild_taken', 'That name or tag is taken.', 409);
        }

        try {
            return DB::transaction(function () use ($leader, $name, $tag, $key) {
                $guild = Guild::query()->create([
                    'public_id' => (string) Str::ulid(),
                    'name' => $name,
                    'tag' => $tag,
                    'leader_id' => $leader->id,
                    'create_key' => $key,
                ]);
                GuildMember::query()->create(['guild_id' => $guild->id, 'user_id' => $leader->id, 'role' => 'leader']);
                $fee = (int) config('platform.guilds.creation_fee');
                if ($fee > 0) {
                    $this->ledger->burn($leader, $this->currency(), $fee, "Founding the guild {$name}", "guild:{$guild->public_id}");
                }
                $this->ledger->guildAccount($guild, $this->currency());
                $this->audit->record(action: 'guild.create', actor: $leader, subjectType: 'guild', subjectId: $guild->public_id, payload: ['name' => $name, 'tag' => $tag]);

                return $guild;
            });
        } catch (QueryException $e) {
            if ($existing = Guild::query()->where('leader_id', $leader->id)->where('create_key', $key)->first()) {
                $existing->wasReplayed = true;

                return $existing;
            }
            throw new MarketException('guild_taken', 'That name or tag is taken.', 409);
        }
    }

    public function invite(User $actor, Guild $guild, User $player): GuildInvite
    {
        $this->assertRole($actor, $guild, ['leader', 'officer']);
        if (GuildMember::query()->where('user_id', $player->id)->exists()) {
            throw new MarketException('in_guild', 'That player is already in a guild.', 409);
        }
        if ($guild->members()->count() >= (int) config('platform.guilds.max_members')) {
            throw new MarketException('guild_full', 'The guild is full.', 409);
        }

        return GuildInvite::query()->firstOrCreate(
            ['guild_id' => $guild->id, 'user_id' => $player->id],
            ['invited_by' => $actor->id],
        );
    }

    public function join(User $player, Guild $guild): GuildMember
    {
        return DB::transaction(function () use ($player, $guild) {
            $invite = GuildInvite::query()->where('guild_id', $guild->id)->where('user_id', $player->id)->lockForUpdate()->first();
            if (! $invite) {
                throw new MarketException('not_invited', 'You have no invitation to that guild.', 403);
            }
            if (GuildMember::query()->where('user_id', $player->id)->exists()) {
                throw new MarketException('in_guild', 'Leave your guild first.', 409);
            }
            $invite->delete();
            GuildInvite::query()->where('user_id', $player->id)->delete();

            return GuildMember::query()->create(['guild_id' => $guild->id, 'user_id' => $player->id, 'role' => 'member']);
        });
    }

    /** Leave; a leader must hand over first unless they are the last member (then the guild is disbanded). */
    public function leave(User $player, Guild $guild): void
    {
        DB::transaction(function () use ($player, $guild) {
            $member = GuildMember::query()->where('guild_id', $guild->id)->where('user_id', $player->id)->lockForUpdate()->first();
            if (! $member) {
                throw new MarketException('not_member', 'You are not in that guild.', 404);
            }
            if ($member->role === 'leader') {
                if ($guild->members()->count() > 1) {
                    throw new MarketException('leader_must_hand_over', 'Make another member leader first.', 409);
                }
                $this->disband($player, $guild);
            }
            $member->delete();
        });
    }

    public function kick(User $actor, Guild $guild, User $player): void
    {
        DB::transaction(function () use ($actor, $guild, $player) {
            $actorRole = $this->assertRole($actor, $guild, ['leader', 'officer']);
            $member = GuildMember::query()->where('guild_id', $guild->id)->where('user_id', $player->id)->lockForUpdate()->first();
            if (! $member) {
                throw new MarketException('not_member', 'That player is not in the guild.', 404);
            }
            if ($member->role === 'leader' || ($actorRole === 'officer' && $member->role === 'officer')) {
                throw new MarketException('forbidden', 'You may not remove that member.', 403);
            }
            $member->delete();
        });
    }

    /** The leader appoints officers and members, or hands the leadership over. */
    public function setRole(User $actor, Guild $guild, User $player, string $role): GuildMember
    {
        if (! in_array($role, Guild::ROLES, true)) {
            throw new MarketException('bad_role', 'Roles are leader, officer and member.');
        }

        return DB::transaction(function () use ($actor, $guild, $player, $role) {
            $this->assertRole($actor, $guild, ['leader']);
            $member = GuildMember::query()->where('guild_id', $guild->id)->where('user_id', $player->id)->lockForUpdate()->first();
            if (! $member || $player->is($actor)) {
                throw new MarketException('not_member', 'Name another member of the guild.', 404);
            }
            if ($role === 'leader') {
                GuildMember::query()->where('guild_id', $guild->id)->where('user_id', $actor->id)->update(['role' => 'officer']);
                $guild->leader_id = $player->id;
                $guild->save();
            }
            $member->role = $role;
            $member->save();
            $this->audit->record(action: 'guild.role', actor: $actor, subjectType: 'guild', subjectId: $guild->public_id, payload: ['player' => $player->public_id, 'role' => $role]);

            return $member;
        });
    }

    /** Any member pays into the treasury. */
    public function deposit(User $member, Guild $guild, int $amount, string $key): LedgerTransaction
    {
        $this->assertRole($member, $guild, Guild::ROLES);
        $this->assertAmount($amount);

        return $this->ledger->post(new Posting(
            type: 'transfer',
            reason: "Deposit to {$guild->name}",
            idempotencyKey: "guild:deposit:{$member->public_id}:{$key}",
            legs: [
                new Leg($this->ledger->walletFor($member, $this->currency())->account, -$amount),
                new Leg($this->ledger->guildAccount($guild, $this->currency()), $amount),
            ],
            referenceType: 'guild',
            referenceId: $guild->public_id,
            initiatedBy: $member->id,
        ));
    }

    /** The leader or an officer pays out of the treasury to a member. */
    public function withdraw(User $actor, Guild $guild, User $to, int $amount, string $key): LedgerTransaction
    {
        $this->assertRole($actor, $guild, ['leader', 'officer']);
        if (! GuildMember::query()->where('guild_id', $guild->id)->where('user_id', $to->id)->exists()) {
            throw new MarketException('not_member', 'Pay out only to members.', 404);
        }
        $this->assertAmount($amount);
        $transaction = $this->ledger->post(new Posting(
            type: 'transfer',
            reason: "Payout from {$guild->name}",
            idempotencyKey: "guild:withdraw:{$actor->public_id}:{$key}",
            legs: [
                new Leg($this->ledger->guildAccount($guild, $this->currency()), -$amount),
                new Leg($this->ledger->walletFor($to, $this->currency())->account, $amount),
            ],
            referenceType: 'guild',
            referenceId: $guild->public_id,
            initiatedBy: $actor->id,
            metadata: ['to' => $to->public_id],
        ));
        $this->audit->record(action: 'guild.withdraw', actor: $actor, subjectType: 'guild', subjectId: $guild->public_id, payload: ['to' => $to->public_id, 'amount' => $amount]);

        return $transaction;
    }

    private function disband(User $leader, Guild $guild): void
    {
        $treasury = $this->ledger->guildAccount($guild, $this->currency());
        if ($treasury->balance > 0) {
            // What is left goes to the last leader.
            $this->ledger->post(new Posting(
                type: 'transfer',
                reason: "{$guild->name} disbanded",
                idempotencyKey: "guild:disband:{$guild->public_id}",
                legs: [
                    new Leg($treasury, -$treasury->balance),
                    new Leg($this->ledger->walletFor($leader, $this->currency())->account, $treasury->balance),
                ],
                referenceType: 'guild',
                referenceId: $guild->public_id,
                initiatedBy: $leader->id,
            ));
        }
        GuildInvite::query()->where('guild_id', $guild->id)->delete();
        $guild->status = 'disbanded';
        // Free the name and tag for someone else.
        $guild->name = '~'.$guild->public_id;
        $guild->tag = strtolower(substr($guild->public_id, -5));
        $guild->save();
        Land::query()->where('guild_id', $guild->id)->where('status', 'active')->update(['status' => 'released']);
    }

    /** @param  list<string>  $roles */
    private function assertRole(User $user, Guild $guild, array $roles): string
    {
        $role = $guild->status === 'active' ? $guild->roleOf($user) : null;
        if ($role === null || ! in_array($role, $roles, true)) {
            throw new MarketException('forbidden', 'You may not do that in this guild.', 403);
        }

        return $role;
    }

    private function assertAmount(int $amount): void
    {
        if ($amount < 1 || $amount > (int) config('platform.market.max_price')) {
            throw new MarketException('bad_price', 'Amounts are whole Crowns from 1.');
        }
    }
}
