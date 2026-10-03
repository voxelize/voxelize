<?php

use App\Http\Controllers\Api\V1\AuthController;
use App\Http\Controllers\Api\V1\GameTicketController;
use App\Http\Controllers\Api\V1\WalletController;
use Illuminate\Support\Facades\Route;

/*
 * Versioned public API (docs/API.md). Realtime gameplay never goes through
 * here: it speaks the game server protocol (docs/NETWORK_PROTOCOL.md).
 */
Route::prefix('v1')->group(function () {
    Route::post('auth/register', [AuthController::class, 'register'])->middleware('throttle:auth');
    Route::post('auth/login', [AuthController::class, 'login'])->middleware('throttle:auth');

    Route::middleware('auth:sanctum')->group(function () {
        Route::post('auth/logout', [AuthController::class, 'logout']);
        Route::get('me', [AuthController::class, 'me']);

        Route::post('game/tickets', [GameTicketController::class, 'store'])->middleware('throttle:tickets');

        Route::get('wallets', [WalletController::class, 'index']);
        Route::get('wallets/{currency}/entries', [WalletController::class, 'entries']);
        Route::post('transfers', [WalletController::class, 'transfer'])->middleware('throttle:economy');
    });
});
