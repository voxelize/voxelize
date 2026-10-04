<?php

namespace App\Http\Controllers\Internal;

use App\Http\Controllers\Controller;
use App\Services\Social\FriendService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PresenceController extends Controller
{
    /** Who is playing in a world now (sent every half minute). */
    public function store(Request $request, FriendService $friends): JsonResponse
    {
        $data = $request->validate([
            'world' => ['required', 'string', 'max:64'],
            'players' => ['present', 'array', 'max:2000'],
            'players.*' => ['string', 'max:64'],
        ]);

        return response()->json(['seen' => $friends->seen($data['world'], $data['players'])]);
    }
}
