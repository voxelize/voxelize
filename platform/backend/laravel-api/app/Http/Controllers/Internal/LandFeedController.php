<?php

namespace App\Http\Controllers\Internal;

use App\Http\Controllers\Controller;
use App\Services\Land\LandService;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * Every active land of a world, for game servers to enforce. Polled; an
 * unchanged feed answers 304 to the previous ETag.
 */
class LandFeedController extends Controller
{
    public function __invoke(Request $request, LandService $lands): Response
    {
        $world = (string) $request->query('world', '');
        if (! preg_match('/^[a-z0-9_]{1,64}$/', $world)) {
            return response(['error' => ['code' => 'bad_world', 'message' => 'Name a world.']], 400);
        }
        $body = json_encode(['world' => $world, 'lands' => $lands->feed($world)], JSON_THROW_ON_ERROR);
        $etag = '"'.hash('sha256', $body).'"';
        if ($request->header('If-None-Match') === $etag) {
            return response('', 304)->header('ETag', $etag);
        }

        // An explicit length: game servers read the body by it, whatever
        // sits in front of PHP.
        return response($body, 200)
            ->header('Content-Type', 'application/json')
            ->header('Content-Length', (string) strlen($body))
            ->header('ETag', $etag);
    }
}
