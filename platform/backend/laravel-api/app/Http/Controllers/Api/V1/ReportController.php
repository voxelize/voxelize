<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\PlayerReport;
use App\Models\User;
use App\Services\Market\MarketException;
use App\Services\Moderation\ReportService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** Reporting a player from the web, and the reports one has sent. */
class ReportController extends Controller
{
    public function store(Request $request, ReportService $reports): JsonResponse
    {
        $data = $request->validate([
            'player' => ['required', 'string', 'max:64'],
            'category' => ['required', Rule::in(PlayerReport::CATEGORIES)],
            'details' => ['required', 'string', 'min:3', 'max:500'],
            'world' => ['nullable', 'string', 'max:64'],
        ]);
        $target = User::query()->where('username', $data['player'])->orWhere('public_id', $data['player'])->first()
            ?? throw new MarketException('player_not_found', 'No such player.', 404);
        $report = $reports->file($request->user(), $target, $data['category'], $data['details'], 'web', $data['world'] ?? null);

        return response()->json(['report' => $this->mine($report)], 201);
    }

    /** What happened to my reports (moderators' notes stay private). */
    public function index(Request $request): JsonResponse
    {
        $rows = PlayerReport::query()->with('target')->where('reporter_id', $request->user()->id)
            ->latest('id')->limit(50)->get();

        return response()->json(['reports' => $rows->map(fn ($r) => $this->mine($r))]);
    }

    private function mine(PlayerReport $r): array
    {
        return [
            'id' => $r->public_id,
            'player' => $r->target->username,
            'category' => $r->category,
            'details' => $r->details,
            'status' => $r->status,
            'created_at' => $r->created_at?->toIso8601String(),
        ];
    }
}
