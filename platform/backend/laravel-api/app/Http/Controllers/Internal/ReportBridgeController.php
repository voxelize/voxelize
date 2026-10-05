<?php

namespace App\Http\Controllers\Internal;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\Moderation\ReportService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ReportBridgeController extends Controller
{
    /**
     * A player used `/report <name> [category] <what happened>` in the game.
     * The game server adds what it saw (`context`): where both stood and the
     * reported player's last chat lines.
     */
    public function store(Request $request, ReportService $reports): JsonResponse
    {
        $data = $request->validate([
            'world' => ['required', 'string', 'max:64'],
            'reporter' => ['required', 'string', 'max:64'],
            'target' => ['required', 'string', 'max:64'],
            'reason' => ['required', 'string', 'max:600'],
            'context' => ['nullable', 'array'],
        ]);
        $reporter = User::query()->where('public_id', $data['reporter'])->first();
        $target = User::query()->where('public_id', $data['target'])->first();
        if (! $reporter || ! $target) {
            return response()->json(['error' => ['code' => 'player_not_found', 'message' => 'No such player.']], 404);
        }
        [$category, $details] = ReportService::categoryOf($data['reason']);
        $context = $data['context'] ?? null;
        if ($context !== null && strlen((string) json_encode($context)) > 8000) {
            $context = null;
        }
        $report = $reports->file($reporter, $target, $category, $details, 'game', $data['world'], $context);

        return response()->json(['report' => $report->public_id, 'category' => $category], 201);
    }
}
