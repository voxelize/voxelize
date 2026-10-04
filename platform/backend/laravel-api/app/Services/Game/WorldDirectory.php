<?php

namespace App\Services\Game;

use App\Models\Friendship;
use App\Models\User;
use App\Models\World;
use App\Services\Market\MarketException;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Every world tickets can be issued for: the official ones in config
 * (`platform.game.worlds`) and the ones players create. A player-made world
 * is public, open to the owner's friends, or private (members only); the
 * owner always gets in. Game servers report each world's players, which the
 * server browser shows.
 */
class WorldDirectory
{
    /**
     * A world by key, as tickets and the browser see it, or null.
     *
     * @return array{key: string, name: string, realm: string, url: ?string, official: bool, visibility: string, max_players: ?int, world: ?World}|null
     */
    public function find(string $key): ?array
    {
        $official = config("platform.game.worlds.{$key}");
        if ($official) {
            return [
                'key' => $key,
                'name' => $official['name'] ?? Str::headline($key),
                'realm' => $official['realm'],
                'url' => $official['url'],
                'official' => true,
                'visibility' => 'public',
                'max_players' => null,
                'world' => null,
            ];
        }
        $world = World::query()->where('public_id', $key)->where('status', 'active')->first();

        return $world ? $this->entry($world) : null;
    }

    private function entry(World $world): array
    {
        return [
            'key' => $world->public_id,
            'name' => $world->name,
            'realm' => $world->realm,
            'url' => $world->url ?? $this->templateUrl($world->public_id),
            'official' => false,
            'visibility' => $world->visibility,
            'max_players' => (int) $world->max_players,
            'world' => $world,
        ];
    }

    private function templateUrl(string $key): ?string
    {
        $template = (string) config('platform.worlds.url_template');

        return $template !== '' ? str_replace('{world}', $key, $template) : null;
    }

    private function friends(User $a, User $b): bool
    {
        return Friendship::query()->where('status', Friendship::ACCEPTED)
            ->where(fn ($q) => $q->where(fn ($q) => $q->where('user_id', $a->id)->where('friend_id', $b->id))
                ->orWhere(fn ($q) => $q->where('user_id', $b->id)->where('friend_id', $a->id)))
            ->exists();
    }

    public function mayJoin(User $user, array $entry): bool
    {
        $world = $entry['world'];
        if ($entry['official'] || $world->visibility === 'public' || $world->owner_id === $user->id) {
            return true;
        }
        if ($world->members()->whereKey($user->id)->exists()) {
            return true;
        }

        return $world->visibility === 'friends' && $this->friends($user, $world->owner);
    }

    /** Players in a world now, or null when no game server reported it lately. */
    public function players(string $key): ?int
    {
        $rows = DB::table('world_status')->where('world', $key)
            ->where('seen_at', '>=', now()->subSeconds((int) config('platform.worlds.online_seconds')))->get();

        return $rows->isEmpty() ? null : (int) $rows->sum('players');
    }

    /** A game server's report for one dimension of a world. */
    public function report(string $key, string $dimension, int $players): void
    {
        DB::table('world_status')->upsert(
            [['world' => $key, 'dimension' => $dimension, 'players' => $players, 'seen_at' => now()]],
            ['world', 'dimension'],
            ['players', 'seen_at'],
        );
    }

    /** The browser: official worlds, public ones, and the ones open to `user`. */
    public function browse(User $user): Collection
    {
        $official = collect(array_keys((array) config('platform.game.worlds')))->map(fn ($k) => $this->find($k));
        $friendIds = Friendship::query()->where('status', Friendship::ACCEPTED)
            ->where(fn ($q) => $q->where('user_id', $user->id)->orWhere('friend_id', $user->id))->get()
            ->map(fn (Friendship $f) => $f->user_id === $user->id ? $f->friend_id : $f->user_id)->all();
        $made = World::query()->where('status', 'active')
            ->where(fn ($q) => $q->where('visibility', 'public')
                ->orWhere('owner_id', $user->id)
                ->orWhereHas('members', fn ($m) => $m->whereKey($user->id))
                ->orWhere(fn ($q) => $q->where('visibility', 'friends')->whereIn('owner_id', $friendIds ?: [0])))
            ->with('owner:id,public_id,username')->withCount('members')->orderBy('name')->limit(200)->get()
            ->map(fn (World $w) => $this->entry($w));

        return $official->concat($made)->map(fn (array $e) => $this->view($e, $user))
            ->sortBy([fn ($a, $b) => $b['official'] <=> $a['official'], fn ($a, $b) => ($b['players'] ?? -1) <=> ($a['players'] ?? -1)])
            ->values();
    }

    public function view(array $e, ?User $user = null): array
    {
        $world = $e['world'];
        $players = $this->players($e['key']);

        return [
            'key' => $e['key'],
            'name' => $e['name'],
            'realm' => $e['realm'],
            'official' => $e['official'],
            'visibility' => $e['visibility'],
            'owner' => $world ? ['id' => $world->owner->public_id, 'name' => $world->owner->username] : null,
            'mine' => $world !== null && $user !== null && $world->owner_id === $user->id,
            'online' => $players !== null,
            'players' => $players,
            'max_players' => $e['max_players'],
            'url' => $e['url'],
            'members' => $world && $user && $world->owner_id === $user->id
                ? $world->members()->orderBy('username')->pluck('username')->all()
                : null,
        ];
    }

    public function create(User $owner, string $name, string $visibility, string $realm): World
    {
        $name = trim($name);
        if (! preg_match('/^[\pL\pN _\'-]{3,32}$/u', $name)) {
            throw new MarketException('bad_name', 'A world name is 3-32 letters, digits, spaces, _, \' or -.');
        }
        if (! in_array($visibility, World::VISIBILITIES, true) || ! in_array($realm, World::REALMS, true)) {
            throw new MarketException('bad_world', 'Unknown visibility or realm.');
        }

        return DB::transaction(function () use ($owner, $name, $visibility, $realm) {
            User::query()->whereKey($owner->id)->lockForUpdate()->first();
            $count = World::query()->where('owner_id', $owner->id)->where('status', 'active')->count();
            if ($count >= (int) config('platform.worlds.per_player')) {
                throw new MarketException('too_many_worlds', 'You have as many worlds as you may.', 409);
            }
            do {
                $key = 'w_'.strtolower(Str::random(10));
            } while (! preg_match('/^w_[a-z0-9]{10}$/', $key) || World::query()->where('public_id', $key)->exists() || config("platform.game.worlds.{$key}"));

            return World::query()->create([
                'public_id' => $key,
                'name' => $name,
                'owner_id' => $owner->id,
                'visibility' => $visibility,
                'realm' => $realm,
                'max_players' => (int) config('platform.worlds.max_players'),
                'status' => 'active',
            ]);
        });
    }

    /** The owner's world by key (404 for anyone else). */
    public function owned(User $user, string $key): World
    {
        $world = World::query()->where('public_id', $key)->where('status', 'active')->first();
        if (! $world || $world->owner_id !== $user->id) {
            throw new MarketException('world_not_found', 'No such world of yours.', 404);
        }

        return $world;
    }
}
