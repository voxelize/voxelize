<?php

use App\Http\Controllers\Api\V1\AuthController;
use App\Http\Controllers\Api\V1\BlueprintController;
use App\Http\Controllers\Api\V1\ContractController;
use App\Http\Controllers\Api\V1\GameTicketController;
use App\Http\Controllers\Api\V1\GuildController;
use App\Http\Controllers\Api\V1\LandController;
use App\Http\Controllers\Api\V1\MarketController;
use App\Http\Controllers\Api\V1\WalletController;
use App\Http\Controllers\Internal\BlueprintBridgeController;
use App\Http\Controllers\Internal\GuildFeedController;
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
        Route::post('lands/{land}/resize', [LandController::class, 'resize'])->middleware('throttle:economy');
        Route::put('lands/{land}/sale', [LandController::class, 'offer']);
        Route::delete('lands/{land}/sale', [LandController::class, 'withdraw']);
        Route::post('lands/{land}/buy', [LandController::class, 'buy'])->middleware('throttle:economy');
        Route::post('lands/{land}/members', [LandController::class, 'addMember']);
        Route::delete('lands/{land}/members/{player}', [LandController::class, 'removeMember']);

        Route::get('market/listings', [MarketController::class, 'index']);
        Route::get('market/history', [MarketController::class, 'history']);
        Route::get('market/listings/{listing}', [MarketController::class, 'show']);
        Route::post('market/listings/{listing}/buy', [MarketController::class, 'buy'])->middleware('throttle:economy');
        Route::post('market/listings/{listing}/bids', [MarketController::class, 'bid'])->middleware('throttle:economy');
        Route::delete('market/listings/{listing}', [MarketController::class, 'destroy']);
        Route::get('deliveries', [MarketController::class, 'deliveries']);

        Route::get('contracts', [ContractController::class, 'index']);
        Route::post('contracts', [ContractController::class, 'store'])->middleware('throttle:economy');
        Route::post('contracts/{contract}/accept', [ContractController::class, 'accept']);
        Route::post('contracts/{contract}/abandon', [ContractController::class, 'abandon']);
        Route::delete('contracts/{contract}', [ContractController::class, 'destroy']);

        Route::get('guilds', [GuildController::class, 'index']);
        Route::get('guilds/mine', [GuildController::class, 'mine']);
        Route::post('guilds', [GuildController::class, 'store'])->middleware('throttle:economy');
        Route::get('guilds/{guild}', [GuildController::class, 'show']);
        Route::post('guilds/{guild}/invites', [GuildController::class, 'invite']);
        Route::post('guilds/{guild}/join', [GuildController::class, 'join']);
        Route::post('guilds/{guild}/decline', [GuildController::class, 'decline']);
        Route::post('guilds/{guild}/leave', [GuildController::class, 'leave']);
        Route::delete('guilds/{guild}/members/{player}', [GuildController::class, 'kick']);
        Route::put('guilds/{guild}/members/{player}/role', [GuildController::class, 'role']);
        Route::post('guilds/{guild}/deposit', [GuildController::class, 'deposit'])->middleware('throttle:economy');
        Route::post('guilds/{guild}/withdraw', [GuildController::class, 'withdraw'])->middleware('throttle:economy');
        Route::get('guilds/{guild}/entries', [GuildController::class, 'entries']);
        Route::get('guilds/{guild}/messages', [GuildController::class, 'messages']);
        Route::post('guilds/{guild}/messages', [GuildController::class, 'say']);
        Route::put('guilds/{guild}/tax', [GuildController::class, 'tax']);
        Route::post('guilds/{guild}/ranks', [GuildController::class, 'createRank']);
        Route::patch('guilds/{guild}/ranks/{rank}', [GuildController::class, 'updateRank']);
        Route::delete('guilds/{guild}/ranks/{rank}', [GuildController::class, 'deleteRank']);
        Route::put('guilds/{guild}/members/{player}/rank', [GuildController::class, 'assignRank']);
        Route::get('guilds/{guild}/relations', [GuildController::class, 'relations']);
        Route::post('guilds/{guild}/alliances', [GuildController::class, 'ally']);
        Route::delete('guilds/{guild}/alliances/{other}', [GuildController::class, 'endAlliance']);
        Route::post('guilds/{guild}/wars', [GuildController::class, 'declareWar'])->middleware('throttle:economy');
        Route::post('guilds/{guild}/wars/{other}/peace', [GuildController::class, 'peace']);

        Route::get('blueprints', [BlueprintController::class, 'index']);
        Route::get('blueprints/mine', [BlueprintController::class, 'mine']);
        Route::get('blueprints/review', [BlueprintController::class, 'reviewQueue']);
        Route::post('blueprints/{blueprint}/review', [BlueprintController::class, 'review']);
        Route::get('blueprints/{blueprint}/revisions', [BlueprintController::class, 'revisions']);
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
    Route::get('guilds', GuildFeedController::class);
    Route::post('wars/kills', [GuildFeedController::class, 'kill']);
    Route::post('wars/captures', [GuildFeedController::class, 'capture']);
    Route::post('market/listings', [MarketBridgeController::class, 'createListing']);
    Route::post('payments', [MarketBridgeController::class, 'payment']);
    Route::post('contracts/{contract}/fulfil', [MarketBridgeController::class, 'fulfil']);
    Route::post('blueprints', [BlueprintBridgeController::class, 'store']);
    Route::get('blueprints/{blueprint}', [BlueprintBridgeController::class, 'show']);
    Route::post('deliveries/pending', [MarketBridgeController::class, 'pending']);
    Route::post('deliveries/{delivery}/ack', [MarketBridgeController::class, 'acknowledge']);
});
