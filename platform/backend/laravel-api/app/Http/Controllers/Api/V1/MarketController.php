<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\ItemDelivery;
use App\Models\MarketListing;
use App\Services\Economy\LedgerService;
use App\Services\Market\MarketService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class MarketController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'world' => ['required', 'string', 'max:64'],
            'item' => ['nullable', 'string', 'max:64'],
            'kind' => ['nullable', 'string', 'in:fixed,auction'],
            'mine' => ['nullable', 'boolean'],
        ]);
        $mine = $request->boolean('mine');
        $listings = MarketListing::query()
            ->where('world', $data['world'])
            ->when(! $mine, fn ($q) => $q->where('status', 'open')->where('ends_at', '>', now()))
            ->when($mine, fn ($q) => $q->where('seller_id', $request->user()->id))
            ->when($data['item'] ?? null, fn ($q, $item) => $q->where('item', $item))
            ->when($data['kind'] ?? null, fn ($q, $kind) => $q->where('kind', $kind))
            ->with(['seller:id,public_id,username'])
            ->orderBy($mine ? 'id' : 'price', $mine ? 'desc' : 'asc')
            ->limit(200)
            ->get();

        return response()->json(['listings' => $listings->map(fn (MarketListing $l) => $this->present($l))]);
    }

    public function show(string $listing): JsonResponse
    {
        return response()->json(['listing' => $this->present($this->find($listing))]);
    }

    public function buy(Request $request, MarketService $market, LedgerService $ledger, string $listing): JsonResponse
    {
        $sold = $market->buy($request->user(), $this->find($listing));

        return response()->json([
            'listing' => $this->present($sold->fresh(['seller'])),
            'replayed' => $sold->wasReplayed,
            'balance' => $ledger->balance($request->user(), $sold->currency),
        ], $sold->wasReplayed ? 200 : 201);
    }

    public function bid(Request $request, MarketService $market, LedgerService $ledger, string $listing): JsonResponse
    {
        $key = (string) $request->header('Idempotency-Key', '');
        if (! preg_match('/^[A-Za-z0-9_-]{8,64}$/', $key)) {
            return response()->json(['error' => [
                'code' => 'idempotency_key_required',
                'message' => 'Send an Idempotency-Key header of 8-64 URL-safe characters.',
            ]], 400);
        }
        $data = $request->validate(['amount' => ['required', 'integer', 'min:1', 'max:1000000000']]);
        $bid = $market->bid($request->user(), $this->find($listing), (int) $data['amount'], $key);

        return response()->json([
            'listing' => $this->present($bid->fresh(['seller'])),
            'replayed' => $bid->wasReplayed,
            'balance' => $ledger->balance($request->user(), $bid->currency),
        ], $bid->wasReplayed ? 200 : 201);
    }

    public function destroy(Request $request, MarketService $market, string $listing): JsonResponse
    {
        $market->cancel($request->user(), $this->find($listing));

        return response()->json(['cancelled' => true]);
    }

    /** Goods on their way to me (handed over when I am in that world). */
    public function deliveries(Request $request): JsonResponse
    {
        $rows = ItemDelivery::query()
            ->where('user_id', $request->user()->id)
            ->where('status', 'pending')
            ->orderBy('id')
            ->limit(200)
            ->get();

        return response()->json(['deliveries' => $rows->map(fn (ItemDelivery $d) => [
            'id' => $d->public_id,
            'world' => $d->world,
            'item' => $d->item,
            'count' => $d->count,
            'reason' => $d->reason,
        ])]);
    }

    private function find(string $publicId): MarketListing
    {
        return MarketListing::query()->where('public_id', $publicId)->with('seller')->firstOr(fn () => abort(response()->json([
            'error' => ['code' => 'listing_not_found', 'message' => 'No such listing.'],
        ], 404)));
    }

    /** @return array<string, mixed> */
    private function present(MarketListing $l): array
    {
        $market = app(MarketService::class);

        return [
            'id' => $l->public_id,
            'kind' => $l->kind,
            'world' => $l->world,
            'item' => $l->item,
            'count' => $l->count,
            'durability' => $l->durability,
            'currency' => $l->currency,
            'price' => $l->price,
            'buyout' => $l->buyout,
            'current_bid' => $l->current_bid,
            'bid_count' => $l->bid_count,
            'minimum_bid' => $l->kind === 'auction' ? $market->minimumBid($l) : null,
            'seller' => ['id' => $l->seller->public_id, 'name' => $l->seller->username],
            'status' => $l->status,
            'ends_at' => $l->ends_at->toIso8601String(),
        ];
    }
}
