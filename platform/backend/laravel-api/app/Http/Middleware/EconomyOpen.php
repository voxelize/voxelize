<?php

namespace App\Http\Middleware;

use App\Services\Economy\EconomyFreeze;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** Refuses requests that move money while the economy is frozen. */
class EconomyOpen
{
    public function __construct(private readonly EconomyFreeze $freeze) {}

    public function handle(Request $request, Closure $next): Response
    {
        if ($this->freeze->state() !== null) {
            return response()->json(['error' => [
                'code' => 'economy_frozen',
                'message' => 'Trading is paused while the books are checked. Please try again later.',
            ]], 503);
        }

        return $next($request);
    }
}
