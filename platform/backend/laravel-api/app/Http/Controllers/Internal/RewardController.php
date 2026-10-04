<?php

namespace App\Http\Controllers\Internal;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\Rewards\RewardService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class RewardController extends Controller
{
    /** A job or quest payout for a player (minted, capped per day). */
    public function store(Request $request, RewardService $rewards): JsonResponse
    {
        $data = $request->validate([
            'key' => ['required', 'string', 'regex:/^[A-Za-z0-9_-]{8,100}$/'],
            'player' => ['required', 'string', 'max:64'],
            'world' => ['required', 'string', 'max:64'],
            'source' => ['required', 'string', 'in:job,quest'],
            'reason' => ['required', 'string', 'max:120'],
            'amount' => ['required', 'integer', 'min:1', 'max:100000'],
        ]);
        $user = User::query()->where('public_id', $data['player'])->first();
        if (! $user || ! $user->isActive()) {
            return response()->json(['error' => ['code' => 'player_not_found', 'message' => 'No active player with that id.']], 404);
        }
        $reward = $rewards->pay($user, $data['world'], $data['source'], $data['reason'], (int) $data['amount'], $data['key']);

        return response()->json([
            'paid' => (int) $reward->paid,
            'requested' => (int) $reward->requested,
            'paid_today' => $rewards->paidToday($user),
            'daily_cap' => $rewards->dailyCap(),
        ]);
    }
}
