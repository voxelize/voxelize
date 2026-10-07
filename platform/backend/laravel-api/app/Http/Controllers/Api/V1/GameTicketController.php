<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\Game\TicketIssuer;
use App\Services\Game\WorldDirectory;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class GameTicketController extends Controller
{
    public function store(Request $request, TicketIssuer $issuer, WorldDirectory $worlds): JsonResponse
    {
        $data = $request->validate(['world' => ['required', 'string', 'max:64']]);

        $user = $request->user();
        if (! $user->isActive()) {
            return response()->json(['error' => ['code' => 'account_'.$user->status, 'message' => 'This account cannot join worlds.']], 403);
        }
        if (config('platform.auth.require_verified_email') && $user->email_verified_at === null) {
            return response()->json(['error' => ['code' => 'email_unverified', 'message' => 'Confirm your email address first (see your inbox).']], 403);
        }
        $world = $worlds->find($data['world']);
        if (! $world) {
            return response()->json(['message' => 'The selected world is invalid.', 'errors' => ['world' => ['The selected world is invalid.']]], 422);
        }
        if (! $worlds->mayJoin($user, $world)) {
            return response()->json(['error' => ['code' => 'world_closed', 'message' => 'That world is not open to you.']], 403);
        }
        if ($world['url'] === null) {
            return response()->json(['error' => ['code' => 'world_offline', 'message' => 'No server hosts that world yet.']], 409);
        }
        $players = $worlds->players($world['key']);
        if ($world['max_players'] !== null && $players !== null && $players >= $world['max_players'] && ($world['world']->owner_id !== $user->id)) {
            return response()->json(['error' => ['code' => 'world_full', 'message' => 'That world is full.']], 409);
        }

        return response()->json($issuer->issue($user, $world['key'], $request->ip()), 201);
    }
}
