<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\Game\TicketIssuer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class GameTicketController extends Controller
{
    public function store(Request $request, TicketIssuer $issuer): JsonResponse
    {
        $data = $request->validate([
            'world' => ['required', 'string', Rule::in(array_keys(config('platform.game.worlds')))],
        ]);

        $user = $request->user();
        if (! $user->isActive()) {
            return response()->json(['error' => ['code' => 'account_'.$user->status, 'message' => 'This account cannot join worlds.']], 403);
        }

        return response()->json($issuer->issue($user, $data['world'], $request->ip()), 201);
    }
}
