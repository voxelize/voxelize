<?php

namespace App\Services\Land;

use App\Models\Guild;
use App\Models\GuildMember;
use App\Models\Land;
use App\Models\LandHistory;
use App\Models\LandLock;
use App\Models\LandMember;
use App\Models\User;
use App\Services\Audit\AuditLogger;
use App\Services\Economy\LedgerService;
use App\Services\Economy\Leg;
use App\Services\Economy\Posting;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Claims, releases and memberships. Game servers enforce what lands allow
 * (docs/SECURITY.md); this service is the only writer.
 */
class LandService
{
    public function __construct(
        private readonly LedgerService $ledger,
        private readonly AuditLogger $audit,
    ) {}

    /** Price of a claim of `$chunks` chunks, in minor units. */
    public function price(int $chunks): int
    {
        return $chunks * (int) config('platform.land.price_per_chunk');
    }

    /**
     * Claim a box of chunks, paying for it from the owner's wallet. A retry
     * with the same idempotency key returns the land the first call made.
     *
     * @param  array{0: int, 1: int}  $min
     * @param  array{0: int, 1: int}  $max
     */
    public function claim(User $owner, string $world, string $dimension, array $min, array $max, string $name, string $idempotencyKey, ?Guild $guild = null): Land
    {
        if ($existing = Land::query()->where('owner_id', $owner->id)->where('claim_key', $idempotencyKey)->first()) {
            $existing->wasReplayed = true;

            return $existing;
        }

        if (! array_key_exists($world, (array) config('platform.game.worlds'))) {
            throw new LandException('unknown_world', 'No such world.', 404);
        }
        if (! in_array($dimension, (array) config('platform.land.dimensions'), true)) {
            throw new LandException('unknown_dimension', 'No such dimension.', 404);
        }
        [$minX, $minZ] = [min($min[0], $max[0]), min($min[1], $max[1])];
        [$maxX, $maxZ] = [max($min[0], $max[0]), max($min[1], $max[1])];
        $side = (int) config('platform.land.max_side_chunks');
        if ($maxX - $minX + 1 > $side || $maxZ - $minZ + 1 > $side) {
            throw new LandException('claim_too_large', "A claim is at most {$side} chunks along each side.");
        }
        $chunks = ($maxX - $minX + 1) * ($maxZ - $minZ + 1);

        try {
            return $this->claimLocked($owner, $world, $dimension, $minX, $minZ, $maxX, $maxZ, $chunks, $name, $idempotencyKey, $guild);
        } catch (QueryException $e) {
            // Lost a race with the same request: answer with the winner's land.
            if ($existing = Land::query()->where('owner_id', $owner->id)->where('claim_key', $idempotencyKey)->first()) {
                $existing->wasReplayed = true;

                return $existing;
            }
            throw $e;
        }
    }

    private function claimLocked(User $owner, string $world, string $dimension, int $minX, int $minZ, int $maxX, int $maxZ, int $chunks, string $name, string $idempotencyKey, ?Guild $guild): Land
    {
        return DB::transaction(function () use ($owner, $world, $dimension, $minX, $minZ, $maxX, $maxZ, $chunks, $name, $idempotencyKey, $guild) {
            // Serialise every claim in this world and dimension.
            LandLock::query()->firstOrCreate(['world' => $world, 'dimension' => $dimension]);
            LandLock::query()->where('world', $world)->where('dimension', $dimension)->lockForUpdate()->first();

            if ($guild) {
                $role = GuildMember::query()->where('guild_id', $guild->id)->where('user_id', $owner->id)->value('role');
                if (! in_array($role, ['leader', 'officer'], true)) {
                    throw new LandException('forbidden', 'Only guild officers claim land for the guild.', 403);
                }
                $held = Land::query()->where('guild_id', $guild->id)->where('status', 'active')->get()
                    ->sum(fn (Land $land) => $land->chunkCount());
                $limit = (int) config('platform.guilds.max_chunks');
            } else {
                $held = Land::query()->where('owner_id', $owner->id)->whereNull('guild_id')->where('status', 'active')->get()
                    ->sum(fn (Land $land) => $land->chunkCount());
                $limit = (int) config('platform.land.max_chunks_per_player');
            }
            if ($held + $chunks > $limit) {
                throw new LandException('land_limit', "At most {$limit} chunks of land may be held.");
            }

            $overlap = Land::query()
                ->where('world', $world)->where('dimension', $dimension)->where('status', 'active')
                ->where('min_chunk_x', '<=', $maxX)->where('max_chunk_x', '>=', $minX)
                ->where('min_chunk_z', '<=', $maxZ)->where('max_chunk_z', '>=', $minZ)
                ->exists();
            if ($overlap) {
                throw new LandException('land_taken', 'Part of that area is already claimed.', 409);
            }

            $price = $this->price($chunks);
            $currency = (string) config('platform.land.currency');
            // A guild pays from its treasury.
            $payment = $guild
                ? $this->ledger->post(new Posting(
                    type: 'burn',
                    reason: "Guild land claim ({$chunks} chunks)",
                    idempotencyKey: "land:guild:{$guild->public_id}:{$idempotencyKey}",
                    legs: [
                        new Leg($this->ledger->guildAccount($guild, $currency), -$price),
                        new Leg($this->ledger->systemAccount('burn', $currency), $price),
                    ],
                    referenceType: 'guild',
                    referenceId: $guild->public_id,
                    initiatedBy: $owner->id,
                ))
                : $this->ledger->burn($owner, $currency, $price, "Land claim ({$chunks} chunks)", "land:{$idempotencyKey}");

            $land = Land::query()->create([
                'public_id' => (string) Str::ulid(),
                'world' => $world,
                'dimension' => $dimension,
                'owner_id' => $owner->id,
                'guild_id' => $guild?->id,
                'name' => $name,
                'min_chunk_x' => $minX,
                'min_chunk_z' => $minZ,
                'max_chunk_x' => $maxX,
                'max_chunk_z' => $maxZ,
                'permissions' => Land::DEFAULT_PERMISSIONS,
                'status' => 'active',
                'claim_key' => $idempotencyKey,
            ]);
            $this->history($land, 'claimed', $owner, ['chunks' => $chunks, 'price' => $price], $payment->id);
            $this->audit->record(
                action: 'land.claim',
                actor: $owner,
                subjectType: 'land',
                subjectId: $land->public_id,
                reason: null,
                payload: ['world' => $world, 'dimension' => $dimension, 'min' => [$minX, $minZ], 'max' => [$maxX, $maxZ], 'price' => $price],
            );

            return $land;
        });
    }

    /** Give a land up. Nothing is refunded; the area becomes free. */
    public function release(User $actor, Land $land): Land
    {
        return DB::transaction(function () use ($actor, $land) {
            $land = Land::query()->lockForUpdate()->findOrFail($land->id);
            $this->assertRole($actor, $land, ['owner']);
            if ($land->status !== 'active') {
                throw new LandException('land_released', 'That land was already released.', 409);
            }
            $land->status = 'released';
            $land->version += 1;
            $land->save();
            $this->history($land, 'released', $actor);

            return $land;
        });
    }

    /** Add or change a member. Owners manage everyone; managers manage builders and visitors. */
    public function setMember(User $actor, Land $land, User $member, string $role): LandMember
    {
        if (! in_array($role, Land::ROLES, true)) {
            throw new LandException('bad_role', 'Roles are manager, builder and visitor.');
        }
        if ($member->id === $land->owner_id) {
            throw new LandException('is_owner', 'The owner is not a member.');
        }

        return DB::transaction(function () use ($actor, $land, $member, $role) {
            $land = Land::query()->lockForUpdate()->findOrFail($land->id);
            $this->assertActive($land);
            $actorRole = $this->assertRole($actor, $land, ['owner', 'manager']);
            $current = $land->members()->where('user_id', $member->id)->first();
            if ($actorRole === 'manager' && ($role === 'manager' || $current?->role === 'manager')) {
                throw new LandException('forbidden', 'Only the owner manages managers.', 403);
            }
            $row = LandMember::query()->updateOrCreate(
                ['land_id' => $land->id, 'user_id' => $member->id],
                ['role' => $role],
            );
            $land->version += 1;
            $land->save();
            $this->history($land, 'member_added', $actor, ['member' => $member->public_id, 'role' => $role]);

            return $row;
        });
    }

    public function removeMember(User $actor, Land $land, User $member): void
    {
        DB::transaction(function () use ($actor, $land, $member) {
            $land = Land::query()->lockForUpdate()->findOrFail($land->id);
            $this->assertActive($land);
            $actorRole = $this->assertRole($actor, $land, ['owner', 'manager']);
            $current = $land->members()->where('user_id', $member->id)->first();
            if (! $current) {
                throw new LandException('not_member', 'That player is not a member.', 404);
            }
            if ($actorRole === 'manager' && $current->role === 'manager') {
                throw new LandException('forbidden', 'Only the owner manages managers.', 403);
            }
            $current->delete();
            $land->version += 1;
            $land->save();
            $this->history($land, 'member_removed', $actor, ['member' => $member->public_id]);
        });
    }

    /**
     * Rename a land or change what non-members may do.
     *
     * @param  array<string, bool>|null  $permissions
     */
    public function update(User $actor, Land $land, ?string $name, ?array $permissions): Land
    {
        return DB::transaction(function () use ($actor, $land, $name, $permissions) {
            $land = Land::query()->lockForUpdate()->findOrFail($land->id);
            $this->assertActive($land);
            $this->assertRole($actor, $land, ['owner', 'manager']);
            if ($name !== null) {
                $land->name = $name;
            }
            if ($permissions !== null) {
                $land->permissions = array_merge(Land::DEFAULT_PERMISSIONS, array_intersect_key($permissions, Land::DEFAULT_PERMISSIONS));
            }
            $land->version += 1;
            $land->save();
            $this->history($land, 'updated', $actor, ['name' => $name, 'permissions' => $permissions]);

            return $land;
        });
    }

    /**
     * Every active land of a world, as game servers enforce it.
     *
     * @return list<array<string, mixed>>
     */
    public function feed(string $world): array
    {
        return Land::query()
            ->where('world', $world)->where('status', 'active')
            ->with(['owner:id,public_id,username', 'members.user:id,public_id', 'guild.members.user:id,public_id,username', 'guild.leader:id,public_id,username'])
            ->orderBy('id')
            ->get()
            ->map(fn (Land $land) => [
                'id' => $land->public_id,
                'name' => $land->name,
                'dimension' => $land->dimension,
                'min' => [$land->min_chunk_x, $land->min_chunk_z],
                'max' => [$land->max_chunk_x, $land->max_chunk_z],
                // Guild land belongs to the guild's leader; its members build there.
                'owner' => $land->guild
                    ? ['id' => $land->guild->leader->public_id, 'name' => $land->guild->leader->username]
                    : ['id' => $land->owner->public_id, 'name' => $land->owner->username],
                'guild' => $land->guild ? ['id' => $land->guild->public_id, 'name' => $land->guild->name, 'tag' => $land->guild->tag] : null,
                'members' => $land->members->map(fn (LandMember $m) => ['id' => $m->user->public_id, 'role' => $m->role])
                    ->concat($land->guild ? $land->guild->members
                        ->filter(fn (GuildMember $m) => $m->role !== 'leader')
                        ->map(fn (GuildMember $m) => ['id' => $m->user->public_id, 'role' => $m->role === 'officer' ? 'manager' : 'builder']) : [])
                    ->values()->all(),
                'public' => array_merge(Land::DEFAULT_PERMISSIONS, (array) $land->permissions),
                'version' => $land->version,
            ])
            ->all();
    }

    private function assertActive(Land $land): void
    {
        if ($land->status !== 'active') {
            throw new LandException('land_released', 'That land was released.', 409);
        }
    }

    /** @param  list<string>  $roles */
    private function assertRole(User $actor, Land $land, array $roles): string
    {
        $role = $land->roleOf($actor);
        if ($role === null || ! in_array($role, $roles, true)) {
            throw new LandException('forbidden', 'You may not change this land.', 403);
        }

        return $role;
    }

    /** @param  array<string, mixed>|null  $details */
    private function history(Land $land, string $event, ?User $actor, ?array $details = null, ?int $transactionId = null): void
    {
        LandHistory::query()->create([
            'land_id' => $land->id,
            'event' => $event,
            'actor_id' => $actor?->id,
            'details' => $details,
            'ledger_transaction_id' => $transactionId,
            'created_at' => now(),
        ]);
    }
}
