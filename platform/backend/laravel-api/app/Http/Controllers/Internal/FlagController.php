<?php

namespace App\Http\Controllers\Internal;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\Audit\AuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class FlagController extends Controller
{
    /**
     * A game server's movement checks caught a player repeatedly. It goes to
     * the audit log (`anticheat.<kind>`) for moderators; nothing is decided
     * automatically.
     */
    public function store(Request $request, AuditLogger $audit): JsonResponse
    {
        $data = $request->validate([
            'world' => ['required', 'string', 'max:64'],
            'player' => ['required', 'string', 'max:64'],
            'kind' => ['required', 'string', 'in:speed,hover,noclip'],
            'count' => ['required', 'integer', 'min:1', 'max:100000'],
        ]);
        $user = User::query()->where('public_id', $data['player'])->first();
        if (! $user) {
            return response()->json(['error' => ['code' => 'player_not_found', 'message' => 'No such player.']], 404);
        }
        $audit->record('anticheat.'.$data['kind'], null, 'user', $user->public_id, "{$data['count']} violations in 5 minutes", [
            'world' => $data['world'],
            'count' => $data['count'],
        ]);

        return response()->json(['recorded' => true], 201);
    }
}
