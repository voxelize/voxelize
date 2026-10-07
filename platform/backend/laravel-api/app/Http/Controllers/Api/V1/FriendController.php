<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\Social\FriendService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class FriendController extends Controller
{
    /** Friends (online first), requests waiting for me and requests I sent. */
    public function index(Request $request, FriendService $friends): JsonResponse
    {
        return response()->json([...$friends->lists($request->user()), 'limit' => $friends->limit()]);
    }

    /** Ask a player (by name) to be friends; accepts their request if they asked first. */
    public function store(Request $request, FriendService $friends): JsonResponse
    {
        $data = $request->validate(['player' => ['required', 'string', 'max:24']]);
        $row = $friends->request($request->user(), $this->player($data['player']));

        return response()->json(['status' => $row->status], $row->wasRecentlyCreated ? 201 : 200);
    }

    public function accept(Request $request, FriendService $friends, string $player): JsonResponse
    {
        $row = $friends->accept($request->user(), $this->player($player));

        return response()->json(['status' => $row->status]);
    }

    /** Unfriend, decline or withdraw. */
    public function destroy(Request $request, FriendService $friends, string $player): JsonResponse
    {
        return response()->json(['removed' => $friends->remove($request->user(), $this->player($player))]);
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
