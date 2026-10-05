<?php

namespace App\Services\Social;

use App\Models\Friendship;
use App\Models\User;
use App\Services\Market\MarketException;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Friends: one asks, the other accepts. Asking someone who already asked you
 * accepts their request. Either side may end it (or decline, or withdraw).
 */
class FriendService
{
    public function limit(): int
    {
        return (int) config('platform.friends.limit');
    }

    /** Seconds between writes of a player's `last_seen_at` while they play. */
    public const LAST_SEEN_EVERY = 300;

    private static function key(string $publicId): string
    {
        return "presence:{$publicId}";
    }

    /**
     * Where a player is playing now (a game server reported them in the
     * last `online_seconds`), or null. Presence lives in the cache (Redis
     * in production), not in the database.
     */
    public function where(User $user): ?string
    {
        $world = Cache::get(self::key($user->public_id));

        return is_string($world) ? $world : null;
    }

    /** Whether a player counts as online (seen by a game server lately). */
    public function online(User $user): bool
    {
        return $this->where($user) !== null;
    }

    /** The row between two players, whoever asked. */
    public function between(User $a, User $b): ?Friendship
    {
        return Friendship::query()
            ->where(fn ($q) => $q->where('user_id', $a->id)->where('friend_id', $b->id))
            ->orWhere(fn ($q) => $q->where('user_id', $b->id)->where('friend_id', $a->id))
            ->first();
    }

    public function count(User $user): int
    {
        return Friendship::query()->where('status', Friendship::ACCEPTED)
            ->where(fn ($q) => $q->where('user_id', $user->id)->orWhere('friend_id', $user->id))->count();
    }

    /** Ask `to` to be friends (or accept their request). Returns the row. */
    public function request(User $from, User $to): Friendship
    {
        if ($from->id === $to->id) {
            throw new MarketException('self', 'You cannot befriend yourself.');
        }

        return DB::transaction(function () use ($from, $to) {
            $row = $this->between($from, $to);
            if ($row?->status === Friendship::ACCEPTED) {
                throw new MarketException('already_friends', 'You are friends already.', 409);
            }
            if ($row && $row->user_id === $from->id) {
                return $row;
            }
            if ($this->count($from) >= $this->limit()) {
                throw new MarketException('too_many_friends', 'Your friend list is full.', 409);
            }
            if ($row) {
                // They asked first: this accepts.
                if ($this->count($to) >= $this->limit()) {
                    throw new MarketException('too_many_friends', 'Their friend list is full.', 409);
                }
                $row->update(['status' => Friendship::ACCEPTED, 'accepted_at' => now()]);

                return $row;
            }
            if (Friendship::query()->where('user_id', $from->id)->where('status', Friendship::PENDING)->count() >= $this->limit()) {
                throw new MarketException('too_many_requests', 'Too many requests waiting.', 409);
            }

            return Friendship::query()->create(['user_id' => $from->id, 'friend_id' => $to->id, 'status' => Friendship::PENDING]);
        });
    }

    /** Accept a request `from` sent to `user`. */
    public function accept(User $user, User $from): Friendship
    {
        $row = Friendship::query()->where('user_id', $from->id)->where('friend_id', $user->id)
            ->where('status', Friendship::PENDING)->first();
        if (! $row) {
            throw new MarketException('no_request', 'No request from that player.', 404);
        }

        return $this->request($user, $from);
    }

    /** End a friendship, decline a request or withdraw one. */
    public function remove(User $user, User $other): bool
    {
        return (bool) $this->between($user, $other)?->delete();
    }

    /**
     * Friends (with whether they are online and where), requests waiting
     * for `user` and requests `user` sent.
     *
     * @return array{friends: Collection, incoming: Collection, outgoing: Collection}
     */
    public function lists(User $user): array
    {
        $rows = Friendship::query()
            ->where(fn ($q) => $q->where('user_id', $user->id)->orWhere('friend_id', $user->id))
            ->with(['user', 'friend'])->get();
        $other = fn (Friendship $f) => $f->user_id === $user->id ? $f->friend : $f->user;
        $accepted = $rows->where('status', Friendship::ACCEPTED);
        // Every friend's presence in one cache round trip.
        $ids = $accepted->map(fn (Friendship $f) => $other($f)->public_id)->values()->all();
        $where = [];
        foreach ($ids ? Cache::many(array_map(self::key(...), $ids)) : [] as $key => $world) {
            if (is_string($world)) {
                $where[substr($key, strlen('presence:'))] = $world;
            }
        }
        $friends = $accepted->map(function (Friendship $f) use ($other, $where) {
            $u = $other($f);
            $world = $where[$u->public_id] ?? null;
            $online = $world !== null;

            return [
                'player' => $u->public_id,
                'username' => $u->username,
                'online' => $online,
                'world' => $world,
                'last_seen_at' => $u->last_seen_at?->toIso8601String(),
                'since' => $f->accepted_at?->toIso8601String(),
            ];
        })->sortBy([fn ($a, $b) => $b['online'] <=> $a['online'], fn ($a, $b) => strcasecmp($a['username'], $b['username'])])->values();
        $pending = $rows->where('status', Friendship::PENDING);
        $card = fn (User $u) => ['player' => $u->public_id, 'username' => $u->username];

        return [
            'friends' => $friends,
            'incoming' => $pending->where('friend_id', $user->id)->map(fn (Friendship $f) => $card($f->user))->values(),
            'outgoing' => $pending->where('user_id', $user->id)->map(fn (Friendship $f) => $card($f->friend))->values(),
        ];
    }

    /**
     * A game server's list of who is playing in `world` now: presence in
     * the cache for `online_seconds`; `last_seen_at` in the database at
     * most every five minutes per player (it only says "seen 2 h ago").
     */
    public function seen(string $world, array $players): int
    {
        $known = User::query()->whereIn('public_id', $players)->pluck('public_id')->all();
        if (! $known) {
            return 0;
        }
        Cache::putMany(array_fill_keys(array_map(self::key(...), $known), $world), (int) config('platform.friends.online_seconds'));
        User::query()->whereIn('public_id', $known)
            ->where(fn ($q) => $q->whereNull('last_seen_at')->orWhere('last_seen_at', '<', now()->subSeconds(self::LAST_SEEN_EVERY))->orWhere('last_world', '!=', $world))
            ->update(['last_seen_at' => now(), 'last_world' => $world]);

        return count($known);
    }

    /** Players online right now, across every world (from the reports). */
    public function onlineCount(): int
    {
        return (int) DB::table('world_status')
            ->where('seen_at', '>=', now()->subSeconds((int) config('platform.worlds.online_seconds')))->sum('players');
    }
}
