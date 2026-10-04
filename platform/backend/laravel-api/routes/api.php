<?php

use App\Http\Controllers\Api\V1\AuthController;
use App\Http\Controllers\Api\V1\BlueprintController;
use App\Http\Controllers\Api\V1\GameTicketController;
use App\Http\Controllers\Api\V1\LandController;
use App\Http\Controllers\Api\V1\MarketController;
use App\Http\Controllers\Api\V1\WalletController;
use App\Http\Controllers\Internal\BlueprintBridgeController;
use App\Http\Controllers\Internal\LandFeedController;
use App\Http\Controllers\Internal\MarketBridgeController;
use App\Http\Middleware\GameServiceToken;
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

        Route::get('lands', [LandController::class, 'index']);
        Route::get('lands/quote', [LandController::class, 'quote']);
        Route::post('lands', [LandController::class, 'store'])->middleware('throttle:economy');
        Route::patch('lands/{land}', [LandController::class, 'update']);
        Route::delete('lands/{land}', [LandController::class, 'destroy']);
        Route::post('lands/{land}/members', [LandController::class, 'addMember']);
        Route::delete('lands/{land}/members/{player}', [LandController::class, 'removeMember']);

        Route::get('market/listings', [MarketController::class, 'index']);
        Route::get('market/listings/{listing}', [MarketController::class, 'show']);
        Route::post('market/listings/{listing}/buy', [MarketController::class, 'buy'])->middleware('throttle:economy');
        Route::post('market/listings/{listing}/bids', [MarketController::class, 'bid'])->middleware('throttle:economy');
        Route::delete('market/listings/{listing}', [MarketController::class, 'destroy']);
        Route::get('deliveries', [MarketController::class, 'deliveries']);

        Route::get('blueprints', [BlueprintController::class, 'index']);
        Route::get('blueprints/mine', [BlueprintController::class, 'mine']);
        Route::patch('blueprints/{blueprint}', [BlueprintController::class, 'update']);
        Route::post('blueprints/{blueprint}/buy', [BlueprintController::class, 'buy'])->middleware('throttle:economy');
        Route::get('blueprints/{blueprint}/resales', [BlueprintController::class, 'resales']);
        Route::post('blueprints/{blueprint}/resales', [BlueprintController::class, 'listResale']);
        Route::get('blueprints/{blueprint}/provenance', [BlueprintController::class, 'provenance']);
        Route::post('blueprint-resales/{resale}/buy', [BlueprintController::class, 'buyResale'])->middleware('throttle:economy');
        Route::delete('blueprint-resales/{resale}', [BlueprintController::class, 'cancelResale']);
    });
});

/*
 * Game server to backend, private network only (nginx refuses
 * /api/internal/ on the public listener).
 */
Route::prefix('internal/v1')->middleware(GameServiceToken::class)->group(function () {
    Route::get('lands', LandFeedController::class);
    Route::post('market/listings', [MarketBridgeController::class, 'createListing']);
    Route::post('payments', [MarketBridgeController::class, 'payment']);
    Route::post('blueprints', [BlueprintBridgeController::class, 'store']);
    Route::get('blueprints/{blueprint}', [BlueprintBridgeController::class, 'show']);
    Route::post('deliveries/pending', [MarketBridgeController::class, 'pending']);
    Route::post('deliveries/{delivery}/ack', [MarketBridgeController::class, 'acknowledge']);
});
