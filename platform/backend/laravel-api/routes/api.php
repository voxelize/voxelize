<?php

use App\Http\Controllers\Api\V1\AccountController;
use App\Http\Controllers\Api\V1\AdminController;
use App\Http\Controllers\Api\V1\AuthController;
use App\Http\Controllers\Api\V1\BlueprintController;
use App\Http\Controllers\Api\V1\ContractController;
use App\Http\Controllers\Api\V1\CosmeticController;
use App\Http\Controllers\Api\V1\FriendController;
use App\Http\Controllers\Api\V1\GameTicketController;
use App\Http\Controllers\Api\V1\GuildController;
use App\Http\Controllers\Api\V1\LandController;
use App\Http\Controllers\Api\V1\MarketController;
use App\Http\Controllers\Api\V1\ReportController;
use App\Http\Controllers\Api\V1\WalletController;
use App\Http\Controllers\Api\V1\WorldController;
use App\Http\Controllers\Internal\BlueprintBridgeController;
use App\Http\Controllers\Internal\FlagController;
use App\Http\Controllers\Internal\GuildFeedController;
use App\Http\Controllers\Internal\LandFeedController;
use App\Http\Controllers\Internal\MarketBridgeController;
use App\Http\Controllers\Internal\MetricsController;
use App\Http\Controllers\Internal\PresenceController;
use App\Http\Controllers\Internal\ReportBridgeController;
use App\Http\Controllers\Internal\RewardController;
use App\Http\Controllers\Internal\SanctionFeedController;
use App\Http\Controllers\Internal\WorldFeedController;
use App\Http\Middleware\EconomyOpen;
use App\Http\Middleware\GameServiceToken;
use App\Http\Middleware\RequireRole;
use Illuminate\Support\Facades\Route;

/*
 * Versioned public API (docs/API.md). Realtime gameplay never goes through
 * here: it speaks the game server protocol (docs/NETWORK_PROTOCOL.md).
 */
Route::prefix('v1')->group(function () {
    Route::post('auth/register', [AuthController::class, 'register'])->middleware('throttle:auth');
    Route::post('auth/login', [AuthController::class, 'login'])->middleware('throttle:auth');
    Route::post('auth/password/forgot', [AccountController::class, 'forgot'])->middleware('throttle:auth');
    Route::post('auth/password/reset', [AccountController::class, 'reset'])->middleware('throttle:auth');
    Route::get('auth/email/verify/{id}/{hash}', [AccountController::class, 'verify'])
        ->middleware(['signed', 'throttle:auth'])->name('verification.verify');

    Route::middleware('auth:sanctum')->group(function () {
        Route::post('auth/logout', [AuthController::class, 'logout']);
        Route::get('me', [AuthController::class, 'me']);
        Route::put('me/password', [AccountController::class, 'changePassword'])->middleware('throttle:auth');
        Route::post('me/email/verification', [AccountController::class, 'resendVerification'])->middleware('throttle:auth');
        Route::get('me/export', [AccountController::class, 'export']);
        Route::delete('me', [AccountController::class, 'destroy'])->middleware('throttle:auth');

        Route::post('reports', [ReportController::class, 'store'])->middleware('throttle:economy');
        Route::get('reports', [ReportController::class, 'index']);
        Route::post('game/tickets', [GameTicketController::class, 'store'])->middleware('throttle:tickets');

        Route::get('wallets', [WalletController::class, 'index']);
        Route::get('wallets/{currency}/entries', [WalletController::class, 'entries']);
        Route::post('transfers', [WalletController::class, 'transfer'])->middleware(['throttle:economy', EconomyOpen::class]);

        Route::get('lands', [LandController::class, 'index']);
        Route::get('lands/quote', [LandController::class, 'quote']);
        Route::post('lands', [LandController::class, 'store'])->middleware(['throttle:economy', EconomyOpen::class]);
        Route::patch('lands/{land}', [LandController::class, 'update']);
        Route::delete('lands/{land}', [LandController::class, 'destroy']);
        Route::post('lands/{land}/resize', [LandController::class, 'resize'])->middleware(['throttle:economy', EconomyOpen::class]);
        Route::put('lands/{land}/sale', [LandController::class, 'offer']);
        Route::delete('lands/{land}/sale', [LandController::class, 'withdraw']);
        Route::post('lands/{land}/buy', [LandController::class, 'buy'])->middleware(['throttle:economy', EconomyOpen::class]);
        Route::post('lands/{land}/members', [LandController::class, 'addMember']);
        Route::delete('lands/{land}/members/{player}', [LandController::class, 'removeMember']);

        Route::get('market/listings', [MarketController::class, 'index']);
        Route::get('market/history', [MarketController::class, 'history']);
        Route::get('market/listings/{listing}', [MarketController::class, 'show']);
        Route::post('market/listings/{listing}/buy', [MarketController::class, 'buy'])->middleware(['throttle:economy', EconomyOpen::class]);
        Route::post('market/listings/{listing}/bids', [MarketController::class, 'bid'])->middleware(['throttle:economy', EconomyOpen::class]);
        Route::delete('market/listings/{listing}', [MarketController::class, 'destroy']);
        Route::get('deliveries', [MarketController::class, 'deliveries']);

        Route::get('contracts', [ContractController::class, 'index']);
        Route::post('contracts', [ContractController::class, 'store'])->middleware(['throttle:economy', EconomyOpen::class]);
        Route::post('contracts/{contract}/accept', [ContractController::class, 'accept']);
        Route::post('contracts/{contract}/abandon', [ContractController::class, 'abandon']);
        Route::delete('contracts/{contract}', [ContractController::class, 'destroy']);

        // The admin panel (docs/API.md, "Admin").
        Route::prefix('admin')->middleware(RequireRole::class.':moderator,admin')->group(function () {
            Route::get('players', [AdminController::class, 'players']);
            Route::get('players/{player}', [AdminController::class, 'player']);
            Route::put('players/{player}/status', [AdminController::class, 'status']);
            Route::put('players/{player}/mute', [AdminController::class, 'mute']);
            Route::get('servers', [AdminController::class, 'servers']);
            Route::get('audit', [AdminController::class, 'audit']);
            Route::get('reports', [AdminController::class, 'reports']);
            Route::post('reports/{report}', [AdminController::class, 'handleReport']);
            Route::middleware(RequireRole::class.':admin')->group(function () {
                Route::put('players/{player}/roles', [AdminController::class, 'roles']);
                Route::post('players/{player}/grant', [AdminController::class, 'grant']);
                Route::get('economy', [AdminController::class, 'economy']);
                Route::post('economy/release', [AdminController::class, 'releaseEconomy']);
            });
        });

        Route::get('worlds', [WorldController::class, 'index']);
        Route::post('worlds', [WorldController::class, 'store'])->middleware(['throttle:economy', EconomyOpen::class]);
        Route::patch('worlds/{world}', [WorldController::class, 'update']);
        Route::delete('worlds/{world}', [WorldController::class, 'destroy']);
        Route::post('worlds/{world}/members', [WorldController::class, 'addMember']);
        Route::delete('worlds/{world}/members/{player}', [WorldController::class, 'removeMember']);

        Route::get('cosmetics', [CosmeticController::class, 'index']);
        Route::post('cosmetics/{cosmetic}/buy', [CosmeticController::class, 'buy'])->middleware(['throttle:economy', EconomyOpen::class]);
        Route::put('cosmetics/equipped', [CosmeticController::class, 'equip']);

        Route::get('friends', [FriendController::class, 'index']);
        Route::post('friends', [FriendController::class, 'store'])->middleware('throttle:economy');
        Route::post('friends/{player}/accept', [FriendController::class, 'accept']);
        Route::delete('friends/{player}', [FriendController::class, 'destroy']);

        Route::get('guilds', [GuildController::class, 'index']);
        Route::get('guilds/mine', [GuildController::class, 'mine']);
        Route::post('guilds', [GuildController::class, 'store'])->middleware(['throttle:economy', EconomyOpen::class]);
        Route::get('guilds/{guild}', [GuildController::class, 'show']);
        Route::post('guilds/{guild}/invites', [GuildController::class, 'invite']);
        Route::post('guilds/{guild}/join', [GuildController::class, 'join']);
        Route::post('guilds/{guild}/decline', [GuildController::class, 'decline']);
        Route::post('guilds/{guild}/leave', [GuildController::class, 'leave']);
        Route::delete('guilds/{guild}/members/{player}', [GuildController::class, 'kick']);
        Route::put('guilds/{guild}/members/{player}/role', [GuildController::class, 'role']);
        Route::post('guilds/{guild}/deposit', [GuildController::class, 'deposit'])->middleware(['throttle:economy', EconomyOpen::class]);
        Route::post('guilds/{guild}/withdraw', [GuildController::class, 'withdraw'])->middleware(['throttle:economy', EconomyOpen::class]);
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
        Route::post('guilds/{guild}/wars', [GuildController::class, 'declareWar'])->middleware(['throttle:economy', EconomyOpen::class]);
        Route::post('guilds/{guild}/wars/{other}/peace', [GuildController::class, 'peace']);

        Route::get('blueprints', [BlueprintController::class, 'index']);
        Route::get('blueprints/mine', [BlueprintController::class, 'mine']);
        Route::get('blueprints/review', [BlueprintController::class, 'reviewQueue']);
        Route::post('blueprints/{blueprint}/review', [BlueprintController::class, 'review']);
        Route::get('blueprints/{blueprint}/revisions', [BlueprintController::class, 'revisions']);
        Route::patch('blueprints/{blueprint}', [BlueprintController::class, 'update']);
        Route::post('blueprints/{blueprint}/buy', [BlueprintController::class, 'buy'])->middleware(['throttle:economy', EconomyOpen::class]);
        Route::get('blueprints/{blueprint}/resales', [BlueprintController::class, 'resales']);
        Route::post('blueprints/{blueprint}/resales', [BlueprintController::class, 'listResale']);
        Route::get('blueprints/{blueprint}/provenance', [BlueprintController::class, 'provenance']);
        Route::post('blueprint-resales/{resale}/buy', [BlueprintController::class, 'buyResale'])->middleware(['throttle:economy', EconomyOpen::class]);
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
    Route::post('payments', [MarketBridgeController::class, 'payment'])->middleware(EconomyOpen::class);
    Route::post('contracts/{contract}/fulfil', [MarketBridgeController::class, 'fulfil'])->middleware(EconomyOpen::class);
    Route::post('blueprints', [BlueprintBridgeController::class, 'store']);
    Route::get('blueprints/{blueprint}', [BlueprintBridgeController::class, 'show']);
    Route::post('deliveries/pending', [MarketBridgeController::class, 'pending']);
    Route::post('deliveries/{delivery}/ack', [MarketBridgeController::class, 'acknowledge']);
    Route::post('rewards', [RewardController::class, 'store'])->middleware(EconomyOpen::class);
    Route::post('presence', [PresenceController::class, 'store']);
    Route::get('worlds', WorldFeedController::class);
    Route::get('sanctions', SanctionFeedController::class);
    Route::get('metrics', MetricsController::class);
    Route::post('flags', [FlagController::class, 'store']);
    Route::post('reports', [ReportBridgeController::class, 'store']);
});
