<?php

namespace App\Http\Controllers\Internal;

use App\Http\Controllers\Controller;
use App\Models\ItemDelivery;
use App\Models\User;
use App\Services\Market\MarketService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Game servers hand listed goods to the backend and receive deliveries.
 * Every call is idempotent: listings by the game server's outbox id,
 * acknowledgements by delivery id.
 */
class MarketBridgeController extends Controller
{
    public function createListing(Request $request, MarketService $market): JsonResponse
    {
        $data = $request->validate([
            'key' => ['required', 'string', 'regex:/^[A-Za-z0-9_-]{8,100}$/'],
            'seller' => ['required', 'string', 'max:64'],
            'world' => ['required', 'string', 'max:64'],
            'kind' => ['required', 'string'],
            'item' => ['required', 'string', 'max:64'],
            'count' => ['required', 'integer'],
            'durability' => ['nullable', 'integer', 'min:0'],
            'price' => ['required', 'integer'],
            'buyout' => ['nullable', 'integer'],
            'hours' => ['nullable', 'integer'],
        ]);
        $seller = User::query()->where('public_id', $data['seller'])->first();
        if (! $seller || ! $seller->isActive()) {
            return response()->json(['error' => ['code' => 'seller_not_found', 'message' => 'No active player with that id.']], 404);
        }
        $listing = $market->createListing(
            $seller,
            $data['world'],
            $data['kind'],
            $data['item'],
            (int) $data['count'],
            isset($data['durability']) ? (int) $data['durability'] : null,
            (int) $data['price'],
            isset($data['buyout']) ? (int) $data['buyout'] : null,
            (int) ($data['hours'] ?? config('platform.market.default_hours')),
            $data['key'],
        );

        return response()->json(['listing' => ['id' => $listing->public_id, 'status' => $listing->status], 'replayed' => $listing->wasReplayed], $listing->wasReplayed ? 200 : 201);
    }

    /** A buyer pays a stall's owner; the game server delivers on success. */
    public function payment(Request $request, MarketService $market): JsonResponse
    {
        $data = $request->validate([
            'key' => ['required', 'string', 'regex:/^[A-Za-z0-9_-]{8,100}$/'],
            'from' => ['required', 'string', 'max:64'],
            'to' => ['required', 'string', 'max:64'],
            'amount' => ['required', 'integer'],
            'reason' => ['required', 'string', 'max:200'],
            // `trade`: a direct trade window between two players, no fee.
            'kind' => ['nullable', 'string', 'in:stall,trade'],
        ]);
        $buyer = User::query()->where('public_id', $data['from'])->first();
        $seller = User::query()->where('public_id', $data['to'])->first();
        if (! $buyer || ! $seller || ! $buyer->isActive() || ! $seller->isActive()) {
            return response()->json(['error' => ['code' => 'player_not_found', 'message' => 'Unknown or inactive player.']], 404);
        }
        $transaction = $market->stallSale($buyer, $seller, (int) $data['amount'], $data['key'], $data['reason'], ($data['kind'] ?? 'stall') === 'trade');

        return response()->json(['transaction' => $transaction->public_id, 'replayed' => $transaction->wasReplayed], $transaction->wasReplayed ? 200 : 201);
    }

    public function pending(Request $request, MarketService $market): JsonResponse
    {
        $data = $request->validate([
            'world' => ['required', 'string', 'max:64'],
            'players' => ['present', 'array', 'max:1000'],
            'players.*' => ['string', 'max:64'],
        ]);

        return response()->json(['deliveries' => $market->pendingDeliveries($data['world'], $data['players'])->map(fn (ItemDelivery $d) => [
            'id' => $d->public_id,
            'player' => $d->user->public_id,
            'item' => $d->item,
            'count' => $d->count,
            'durability' => $d->durability,
            'reason' => $d->reason,
        ])]);
    }

    public function acknowledge(MarketService $market, string $delivery): JsonResponse
    {
        $row = ItemDelivery::query()->where('public_id', $delivery)->first();
        if (! $row) {
            return response()->json(['error' => ['code' => 'delivery_not_found', 'message' => 'No such delivery.']], 404);
        }
        $market->acknowledge($row);

        return response()->json(['delivered' => true]);
    }
}
