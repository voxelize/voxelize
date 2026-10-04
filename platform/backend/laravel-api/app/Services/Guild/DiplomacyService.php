<?php

namespace App\Services\Guild;

use App\Models\Guild;
use App\Models\GuildMember;
use App\Models\GuildRelation;
use App\Models\Land;
use App\Models\LandHistory;
use App\Models\LandMember;
use App\Models\User;
use App\Services\Audit\AuditLogger;
use App\Services\Economy\LedgerService;
use App\Services\Economy\Leg;
use App\Services\Economy\Posting;
use App\Services\Market\MarketException;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Between guilds: alliances (one leader proposes, the other accepts; either
 * ends it), wars (a leader declares one for a fee from the treasury; it is
 * fought after a warm-up, scored by kills reported by game servers, and ends
 * when both leaders agree to peace or after its time runs out), and the
 * sales tax a guild levies on stalls on its land.
 */
class DiplomacyService
{
    public function __construct(
        private readonly LedgerService $ledger,
        private readonly AuditLogger $audit,
    ) {}

    public function setTax(User $actor, Guild $guild, int $bps): Guild
    {
        $this->assertLeader($actor, $guild);
        $max = (int) config('platform.guilds.max_tax_bps');
        if ($bps < 0 || $bps > $max) {
            throw new MarketException('bad_tax', 'A tax is 0 to '.($max / 100).' percent.');
        }
        $guild->tax_bps = $bps;
        $guild->save();
        $this->audit->record(action: 'guild.tax', actor: $actor, subjectType: 'guild', subjectId: $guild->public_id, payload: ['bps' => $bps]);

        return $guild;
    }

    /** Every relation of a guild (expired wars removed first). */
    public function relations(Guild $guild): Collection
    {
        $this->expire();

        return GuildRelation::query()
            ->where(fn ($q) => $q->where('guild_a_id', $guild->id)->orWhere('guild_b_id', $guild->id))
            ->with(['guildA', 'guildB'])->orderBy('id')->get();
    }

    /** Propose an alliance, or accept the one the other guild proposed. */
    public function ally(User $actor, Guild $guild, Guild $other): GuildRelation
    {
        $this->assertLeader($actor, $guild);
        $this->assertOther($guild, $other);

        return DB::transaction(function () use ($actor, $guild, $other) {
            $relation = $this->between($guild, $other, lock: true);
            if ($relation?->kind === 'war') {
                throw new MarketException('at_war', 'Make peace first.', 409);
            }
            if ($relation && $relation->status === 'proposed' && $relation->initiator_id === $other->id) {
                $relation->status = 'active';
                $relation->save();
                $this->audit->record(action: 'guild.alliance', actor: $actor, subjectType: 'guild', subjectId: $guild->public_id, payload: ['with' => $other->public_id]);

                return $relation;
            }

            return $relation ?? $this->create($guild, $other, 'alliance', 'proposed');
        });
    }

    /** End an alliance (or withdraw / refuse a proposal). */
    public function endAlliance(User $actor, Guild $guild, Guild $other): void
    {
        $this->assertLeader($actor, $guild);
        $relation = $this->between($guild, $other);
        if (! $relation || $relation->kind !== 'alliance') {
            throw new MarketException('no_alliance', 'There is no alliance with that guild.', 404);
        }
        $relation->delete();
    }

    public function declareWar(User $actor, Guild $guild, Guild $other): GuildRelation
    {
        $this->assertLeader($actor, $guild);
        $this->assertOther($guild, $other);
        $this->expire();

        return DB::transaction(function () use ($actor, $guild, $other) {
            $relation = $this->between($guild, $other, lock: true);
            if ($relation?->kind === 'war') {
                return $relation;
            }
            if ($relation) {
                throw new MarketException('allied', 'End the alliance first.', 409);
            }
            $warmup = (int) config('platform.guilds.war.warmup_minutes');
            $relation = $this->create($guild, $other, 'war', 'active', [
                'starts_at' => now()->addMinutes($warmup),
                'ends_at' => now()->addMinutes($warmup)->addDays((int) config('platform.guilds.war.max_days')),
            ]);
            $fee = (int) config('platform.guilds.war.declaration_fee');
            if ($fee > 0) {
                $currency = (string) config('platform.economy.soft_currency');
                $this->ledger->post(new Posting(
                    type: 'burn',
                    reason: "War declared on {$other->name}",
                    idempotencyKey: "war:declare:{$relation->public_id}",
                    legs: [
                        new Leg($this->ledger->guildAccount($guild, $currency), -$fee),
                        new Leg($this->ledger->systemAccount('burn', $currency), $fee),
                    ],
                    referenceType: 'guild',
                    referenceId: $guild->public_id,
                    initiatedBy: $actor->id,
                ));
            }
            $this->audit->record(action: 'guild.war', actor: $actor, subjectType: 'guild', subjectId: $guild->public_id, payload: ['on' => $other->public_id]);

            return $relation;
        });
    }

    /** Offer peace; when the other side already offered it, the war ends. Returns whether it ended. */
    public function offerPeace(User $actor, Guild $guild, Guild $other): bool
    {
        $this->assertLeader($actor, $guild);

        return DB::transaction(function () use ($actor, $guild, $other) {
            $relation = $this->between($guild, $other, lock: true);
            if (! $relation || $relation->kind !== 'war') {
                throw new MarketException('not_at_war', 'You are not at war with that guild.', 404);
            }
            if ($relation->peace_offered_by === $other->id) {
                $this->audit->record(action: 'guild.peace', actor: $actor, subjectType: 'guild', subjectId: $guild->public_id, payload: ['with' => $other->public_id, 'score' => [$relation->score_a, $relation->score_b]]);
                $relation->delete();

                return true;
            }
            $relation->peace_offered_by = $guild->id;
            $relation->save();

            return false;
        });
    }

    /**
     * A game server reports `$killer` killing `$victim` (`$key`: its kill id).
     * Counts for the killer's guild when their guilds are fighting a war.
     */
    public function recordKill(User $killer, User $victim, string $key): ?GuildRelation
    {
        return DB::transaction(function () use ($killer, $victim, $key) {
            $mine = GuildMember::query()->where('user_id', $killer->id)->value('guild_id');
            $theirs = GuildMember::query()->where('user_id', $victim->id)->value('guild_id');
            if (! $mine || ! $theirs || $mine === $theirs) {
                return null;
            }
            [$a, $b] = $mine < $theirs ? [$mine, $theirs] : [$theirs, $mine];
            $relation = GuildRelation::query()->where('guild_a_id', $a)->where('guild_b_id', $b)->lockForUpdate()->first();
            if (! $relation || ! $relation->fighting()) {
                return null;
            }
            if (DB::table('war_kills')->where('kill_key', $key)->exists()) {
                return $relation;
            }
            DB::table('war_kills')->insert([
                'relation_id' => $relation->id, 'kill_key' => $key,
                'killer_id' => $killer->id, 'victim_id' => $victim->id, 'created_at' => now(),
            ]);
            $relation->increment($mine === $relation->guild_a_id ? 'score_a' : 'score_b');

            return $relation->fresh();
        });
    }

    /**
     * A siege succeeded: the game server reports that `$attacker`'s banner
     * held on `$land` long enough (`$key`: its siege id). When their guilds
     * are fighting, the land passes to the attacker's guild (its leader
     * owns it; individual members of the land are dropped) and the war
     * scores the capture. Once per key.
     */
    public function capture(User $attacker, Land $land, string $key): Land
    {
        return DB::transaction(function () use ($attacker, $land, $key) {
            if (DB::table('war_captures')->where('capture_key', $key)->exists()) {
                $land = $land->fresh();
                $land->wasReplayed = true;

                return $land;
            }
            $land = Land::query()->lockForUpdate()->findOrFail($land->id);
            if ($land->status !== 'active' || $land->guild_id === null) {
                throw new MarketException('not_guild_land', 'Only guild land can be captured.', 409);
            }
            $mine = GuildMember::query()->where('user_id', $attacker->id)->value('guild_id');
            if (! $mine || $mine === $land->guild_id) {
                throw new MarketException('not_at_war', 'That land belongs to no enemy of yours.', 409);
            }
            [$a, $b] = $mine < $land->guild_id ? [$mine, $land->guild_id] : [$land->guild_id, $mine];
            $relation = GuildRelation::query()->where('guild_a_id', $a)->where('guild_b_id', $b)->lockForUpdate()->first();
            if (! $relation || ! $relation->fighting()) {
                throw new MarketException('not_at_war', 'Your guilds are not at war.', 409);
            }
            $winner = Guild::query()->findOrFail($mine);
            $loser = $land->guild_id;
            $land->guild_id = $winner->id;
            $land->owner_id = $winner->leader_id;
            $land->version += 1;
            $land->save();
            LandMember::query()->where('land_id', $land->id)->delete();
            LandHistory::query()->create([
                'land_id' => $land->id,
                'event' => 'captured',
                'actor_id' => $attacker->id,
                'details' => ['from' => Guild::query()->find($loser)?->public_id, 'to' => $winner->public_id, 'war' => $relation->public_id],
                'created_at' => now(),
            ]);
            DB::table('war_captures')->insert([
                'relation_id' => $relation->id, 'land_id' => $land->id,
                'attacker_guild_id' => $winner->id, 'defender_guild_id' => $loser,
                'capture_key' => $key, 'created_at' => now(),
            ]);
            $relation->increment($mine === $relation->guild_a_id ? 'score_a' : 'score_b', (int) config('platform.guilds.war.capture_points'));
            $this->audit->record(action: 'guild.capture', actor: $attacker, subjectType: 'land', subjectId: $land->public_id, payload: ['to' => $winner->public_id, 'war' => $relation->public_id], actorType: 'game_server');

            return $land;
        });
    }

    /** Wars past their end are over. Returns how many ended. */
    public function expire(): int
    {
        return GuildRelation::query()->where('kind', 'war')->whereNotNull('ends_at')->where('ends_at', '<=', now())->delete();
    }

    /** The relation between two guilds, if any. */
    public function between(Guild $one, Guild $two, bool $lock = false): ?GuildRelation
    {
        [$a, $b] = $one->id < $two->id ? [$one->id, $two->id] : [$two->id, $one->id];

        return GuildRelation::query()->where('guild_a_id', $a)->where('guild_b_id', $b)
            ->when($lock, fn ($q) => $q->lockForUpdate())->first();
    }

    /** @param  array<string, mixed>  $extra */
    private function create(Guild $initiator, Guild $other, string $kind, string $status, array $extra = []): GuildRelation
    {
        [$a, $b] = $initiator->id < $other->id ? [$initiator->id, $other->id] : [$other->id, $initiator->id];

        return GuildRelation::query()->create([
            'public_id' => (string) Str::ulid(),
            'guild_a_id' => $a,
            'guild_b_id' => $b,
            'kind' => $kind,
            'status' => $status,
            'initiator_id' => $initiator->id,
            ...$extra,
        ]);
    }

    private function assertLeader(User $user, Guild $guild): void
    {
        if ($guild->status !== 'active' || $guild->roleOf($user) !== 'leader') {
            throw new MarketException('forbidden', 'Only the guild leader may do that.', 403);
        }
    }

    private function assertOther(Guild $guild, Guild $other): void
    {
        if ($other->id === $guild->id || $other->status !== 'active') {
            throw new MarketException('bad_guild', 'Name another active guild.');
        }
    }
}
