<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Admits game servers to /api/internal/*: a bearer token shared on the
 * private network. Without a configured token the internal API is closed.
 */
class GameServiceToken
{
    public function handle(Request $request, Closure $next): Response
    {
        $expected = (string) config('platform.internal.service_token');
        $given = (string) $request->bearerToken();
        if (strlen($expected) < 32 || ! hash_equals($expected, $given)) {
            return response()->json(['error' => ['code' => 'unauthorized', 'message' => 'Game service token required.']], 401);
        }

        $response = $next($request);
        // Game servers read bodies by length, whatever serves PHP.
        $content = $response->getContent();
        if (is_string($content) && ! $response->headers->has('Content-Length')) {
            $response->headers->set('Content-Length', (string) strlen($content));
        }

        return $response;
    }
}
