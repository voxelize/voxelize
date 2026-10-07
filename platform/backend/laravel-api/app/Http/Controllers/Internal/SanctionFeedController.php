<?php

namespace App\Http\Controllers\Internal;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;

class SanctionFeedController extends Controller
{
    /**
     * Players game servers must hold back: suspended or banned (kept out
     * of play) and muted (no chat or voice), with until when.
     */
    public function __invoke(): JsonResponse
    {
        $rows = User::query()
            ->where(fn ($q) => $q->where('status', '!=', User::STATUS_ACTIVE)->orWhere('muted_until', '>', now()))
            ->orderByDesc('sanctioned_at')->limit(10000)->get(['public_id', 'status', 'status_reason', 'muted_until', 'mute_reason']);

        return response()->json(['players' => $rows->map(fn (User $u) => [
            'id' => $u->public_id,
            'status' => $u->status,
            'reason' => $u->status === User::STATUS_ACTIVE ? null : $u->status_reason,
            'muted_until' => $u->isMuted() ? $u->muted_until->getTimestamp() : null,
            'mute_reason' => $u->isMuted() ? $u->mute_reason : null,
        ])]);
    }
}
