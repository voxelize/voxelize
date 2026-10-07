<?php

use App\Services\Economy\EconomyException;
use App\Services\Land\LandException;
use App\Services\Market\MarketException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        //
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
        $exceptions->render(fn (EconomyException $e) => response()->json([
            'error' => ['code' => $e->errorCode, 'message' => $e->getMessage()],
        ], $e->status));
        $exceptions->render(fn (MarketException $e) => response()->json([
            'error' => ['code' => $e->errorCode, 'message' => $e->getMessage()],
        ], $e->status));
        $exceptions->render(fn (LandException $e) => response()->json([
            'error' => ['code' => $e->errorCode, 'message' => $e->getMessage()],
        ], $e->status));
    })->create();
