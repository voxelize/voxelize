<?php

namespace App\Services\Social;

use App\Models\Friendship;
use App\Models\User;
use App\Services\Market\MarketException;
use Illuminate\Support\Collection;
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

    /** Whether a player counts as online (seen by a game server lately). */
    public function online(User $user): bool
    {
        return $user->last_seen_at !== null
            && $user->last_seen_at->gt(now()->subSeconds((int) config('platform.friends.online_seconds')));
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
        $friends = $rows->where('status', Friendship::ACCEPTED)->map(function (Friendship $f) use ($other) {
            $u = $other($f);
            $online = $this->online($u);

            return [
                'player' => $u->public_id,
                'username' => $u->username,
                'online' => $online,
                'world' => $online ? $u->last_world : null,
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

    /** A game server's list of who is playing in `world` now. */
    public function seen(string $world, array $players): int
    {
        return User::query()->whereIn('public_id', $players)
            ->update(['last_seen_at' => now(), 'last_world' => $world]);
    }
}
