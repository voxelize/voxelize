<?php

namespace App\Http\Controllers\Internal;

use App\Http\Controllers\Controller;
use App\Models\World;
use Illuminate\Http\JsonResponse;

class WorldFeedController extends Controller
{
    /** Player-made worlds that want a game server (for whatever hosts them). */
    public function __invoke(): JsonResponse
    {
        return response()->json(['worlds' => World::query()->where('status', 'active')->orderBy('id')->get()
            ->map(fn (World $w) => ['key' => $w->public_id, 'realm' => $w->realm, 'url' => $w->url, 'max_players' => (int) $w->max_players])]);
    }
}
