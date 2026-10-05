<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** `role:moderator,admin` — the signed-in user holds one of the roles. */
class RequireRole
{
    public function handle(Request $request, Closure $next, string ...$roles): Response
    {
        $user = $request->user();
        if (! $user || ! $user->isActive() || ! $user->hasRole(...$roles)) {
            return response()->json(['error' => ['code' => 'forbidden', 'message' => 'This needs the '.implode(' or ', $roles).' role.']], 403);
        }

        return $next($request);
    }
}
