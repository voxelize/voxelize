<?php

namespace App\Http\Controllers\Internal;

use App\Http\Controllers\Controller;
use App\Models\BlueprintDesign;
use App\Models\User;
use App\Services\Blueprint\BlueprintService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Game servers upload captured blueprints and fetch them to build. */
class BlueprintBridgeController extends Controller
{
    public function store(Request $request, BlueprintService $blueprints): JsonResponse
    {
        $data = $request->validate([
            'key' => ['required', 'string', 'regex:/^[A-Za-z0-9_-]{8,100}$/'],
            'creator' => ['required', 'string', 'max:64'],
            'world' => ['required', 'string', 'max:64'],
            'name' => ['required', 'string', 'min:1', 'max:64'],
            'size' => ['required', 'array', 'size:3'],
            'palette' => ['required', 'array'],
            'runs' => ['required', 'array'],
            'materials' => ['present', 'array'],
        ]);
        $creator = User::query()->where('public_id', $data['creator'])->first();
        if (! $creator || ! $creator->isActive()) {
            return response()->json(['error' => ['code' => 'player_not_found', 'message' => 'No active player with that id.']], 404);
        }
        $design = $blueprints->store($creator, $data['world'], $data['name'], $data['size'], $data['palette'], $data['runs'], $data['materials'], $data['key']);

        return response()->json(['blueprint' => ['id' => $design->public_id, 'blocks' => $design->block_count], 'replayed' => $design->wasReplayed], $design->wasReplayed ? 200 : 201);
    }

    /** The layout, for a player allowed to build it. */
    public function show(Request $request, BlueprintService $blueprints, string $blueprint): JsonResponse
    {
        $design = BlueprintDesign::query()->where('public_id', $blueprint)->first();
        $player = User::query()->where('public_id', (string) $request->query('player', ''))->first();
        if (! $design || ! $player) {
            return response()->json(['error' => ['code' => 'blueprint_not_found', 'message' => 'No such blueprint.']], 404);
        }
        if (! $design->mayBuild($player)) {
            return response()->json(['error' => ['code' => 'not_licensed', 'message' => 'That player may not build this blueprint.']], 403);
        }

        return response()->json([
            'id' => $design->public_id,
            'name' => $design->name,
            'materials' => $design->materials,
            'layout' => $blueprints->layout($design),
        ]);
    }
}
