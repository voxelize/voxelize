<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Models\World;
use App\Services\Game\WorldDirectory;
use App\Services\Market\MarketException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class WorldController extends Controller
{
    /** The server browser: worlds I may join, with who is playing. */
    public function index(Request $request, WorldDirectory $worlds): JsonResponse
    {
        return response()->json([
            'worlds' => $worlds->browse($request->user()),
            'per_player' => (int) config('platform.worlds.per_player'),
        ]);
    }

    public function store(Request $request, WorldDirectory $worlds): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:32'],
            'visibility' => ['required', 'string', Rule::in(World::VISIBILITIES)],
            'realm' => ['sometimes', 'string', Rule::in(World::REALMS)],
        ]);
        $world = $worlds->create($request->user(), $data['name'], $data['visibility'], $data['realm'] ?? 'survival');

        return response()->json(['world' => $worlds->view($worlds->find($world->public_id), $request->user())], 201);
    }

    public function update(Request $request, WorldDirectory $worlds, string $world): JsonResponse
    {
        $found = $worlds->owned($request->user(), $world);
        $data = $request->validate([
            'name' => ['sometimes', 'string', 'regex:/^[\pL\pN _\'-]{3,32}$/u'],
            'visibility' => ['sometimes', 'string', Rule::in(World::VISIBILITIES)],
            'max_players' => ['sometimes', 'integer', 'min:1', 'max:'.(int) config('platform.worlds.max_players')],
        ]);
        $found->update($data);

        return response()->json(['world' => $worlds->view($worlds->find($found->public_id), $request->user())]);
    }

    /** Archive: no more tickets; its game server can be stopped. */
    public function destroy(Request $request, WorldDirectory $worlds, string $world): JsonResponse
    {
        $worlds->owned($request->user(), $world)->update(['status' => 'archived']);

        return response()->json(['archived' => true]);
    }

    public function addMember(Request $request, WorldDirectory $worlds, string $world): JsonResponse
    {
        $found = $worlds->owned($request->user(), $world);
        $data = $request->validate(['player' => ['required', 'string', 'max:24']]);
        $user = $this->player($data['player']);
        if ($user->id === $found->owner_id) {
            throw new MarketException('self', 'You own it already.');
        }
        $found->members()->syncWithoutDetaching([$user->id => ['created_at' => now()]]);

        return response()->json(['world' => $worlds->view($worlds->find($found->public_id), $request->user())]);
    }

    public function removeMember(Request $request, WorldDirectory $worlds, string $world, string $player): JsonResponse
    {
        $found = $worlds->owned($request->user(), $world);
        $found->members()->detach($this->player($player)->id);

        return response()->json(['world' => $worlds->view($worlds->find($found->public_id), $request->user())]);
    }

    private function player(string $username): User
    {
        $user = User::query()->where('username', $username)->first();
        if (! $user || ! $user->isActive()) {
            abort(response()->json(['error' => ['code' => 'player_not_found', 'message' => 'No active player with that name.']], 404));
        }

        return $user;
    }
}
