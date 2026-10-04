<?php

namespace App\Http\Controllers\Internal;

use App\Http\Controllers\Controller;
use App\Services\Game\WorldDirectory;
use App\Services\Social\FriendService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PresenceController extends Controller
{
    /**
     * Who is playing in a world (one dimension of it) now, sent every half
     * minute even when nobody is: the server browser counts it online.
     */
    public function store(Request $request, FriendService $friends, WorldDirectory $worlds): JsonResponse
    {
        $data = $request->validate([
            'world' => ['required', 'string', 'max:64'],
            'dimension' => ['sometimes', 'string', 'max:32'],
            'players' => ['present', 'array', 'max:2000'],
            'players.*' => ['string', 'max:64'],
        ]);
        $worlds->report($data['world'], $data['dimension'] ?? 'overworld', count($data['players']));

        return response()->json(['seen' => $data['players'] ? $friends->seen($data['world'], $data['players']) : 0]);
    }
}
