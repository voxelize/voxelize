<?php

namespace App\Services\Market;

use App\Models\ItemDelivery;
use App\Models\LedgerTransaction;
use App\Models\MarketBid;
use App\Models\MarketListing;
use App\Models\User;
use App\Services\Audit\AuditLogger;
use App\Services\Economy\LedgerService;
use App\Services\Economy\Leg;
use App\Services\Economy\Posting;
use Carbon\CarbonInterface;
use Illuminate\Database\QueryException;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Fixed-price listings and auctions. Goods are in the backend's custody
 * while listed (the game server removed them from the seller first) and
 * leave it only as an item delivery; money moves only through the ledger,
 * a sale in one balanced transaction (buyer, seller, fee).
 */
class MarketService
{
    /** An auction ending within this many seconds is extended by a new bid. */
    public const SNIPE_SECONDS = 120;

    public function __construct(
        private readonly LedgerService $ledger,
        private readonly AuditLogger $audit,
    ) {}

    public function fee(int $price): int
    {
        return intdiv($price * (int) config('platform.market.fee_bps'), 10_000);
    }

    /** The lowest acceptable next bid. */
    public function minimumBid(MarketListing $listing): int
    {
        if ($listing->current_bid === null) {
            return $listing->price;
        }
        $step = max(1, intdiv($listing->current_bid * (int) config('platform.market.min_increment_bps'), 10_000));

        return $listing->current_bid + $step;
    }

    /**
     * List goods the game server has already taken from the seller.
     * `$key` is the game server's outbox id: a retry creates nothing new.
     */
    public function createListing(User $seller, string $world, string $kind, string $item, int $count, ?int $durability, int $price, ?int $buyout, int $hours, string $key): MarketListing
    {
        if ($existing = MarketListing::query()->where('listing_key', $key)->first()) {
            if ($existing->seller_id !== $seller->id) {
                throw new MarketException('key_conflict', 'That listing key belongs to another listing.', 409);
            }
            $existing->wasReplayed = true;

            return $existing;
        }
        $max = (int) config('platform.market.max_price');
        if (! in_array($kind, ['fixed', 'auction'], true)) {
            throw new MarketException('bad_kind', 'Listings are fixed or auction.');
        }
        if (! preg_match('/^[a-z0-9_]{1,64}$/', $item) || $count < 1 || $count > 9999) {
            throw new MarketException('bad_goods', 'Name an item and a count of 1-9999.');
        }
        if ($price < 1 || $price > $max) {
            throw new MarketException('bad_price', "Prices are whole amounts from 1 to {$max}.");
        }
        if ($kind === 'fixed' && $buyout !== null) {
            throw new MarketException('bad_price', 'Only auctions have a buyout price.');
        }
        if ($buyout !== null && ($buyout <= $price || $buyout > $max)) {
            throw new MarketException('bad_price', 'A buyout must be above the opening bid.');
        }
        if ($hours < (int) config('platform.market.min_hours') || $hours > (int) config('platform.market.max_hours')) {
            throw new MarketException('bad_duration', 'That listing duration is not allowed.');
        }
        if (! array_key_exists($world, (array) config('platform.game.worlds'))) {
            throw new MarketException('unknown_world', 'No such world.', 404);
        }

        try {
            $listing = MarketListing::query()->create([
                'public_id' => (string) Str::ulid(),
                'seller_id' => $seller->id,
                'world' => $world,
                'kind' => $kind,
                'item' => $item,
                'count' => $count,
                'durability' => $durability,
                'currency' => (string) config('platform.market.currency'),
                'price' => $price,
                'buyout' => $buyout,
                'status' => 'open',
                'ends_at' => now()->addHours($hours),
                'listing_key' => $key,
            ]);
        } catch (QueryException $e) {
            if ($existing = MarketListing::query()->where('listing_key', $key)->first()) {
                $existing->wasReplayed = true;

                return $existing;
            }
            throw $e;
        }
        $this->audit->record(
            action: 'market.list',
            actor: $seller,
            subjectType: 'market_listing',
            subjectId: $listing->public_id,
            payload: ['kind' => $kind, 'item' => $item, 'count' => $count, 'price' => $price, 'buyout' => $buyout],
            actorType: 'game_server',
        );

        return $listing;
    }

    /** Buy a fixed-price listing, or an auction at its buyout price. */
    public function buy(User $buyer, MarketListing $listing): MarketListing
    {
        return DB::transaction(function () use ($buyer, $listing) {
            $listing = MarketListing::query()->lockForUpdate()->findOrFail($listing->id);
            if ($listing->status === 'sold' && $listing->buyer_id === $buyer->id) {
                $listing->wasReplayed = true;

                return $listing; // a retry of this purchase
            }
            $this->assertOpen($listing);
            if ($listing->seller_id === $buyer->id) {
                throw new MarketException('own_listing', 'You cannot buy your own listing.');
            }
            $price = $listing->kind === 'fixed' ? $listing->price : $listing->buyout;
            if ($price === null) {
                throw new MarketException('not_buyable', 'This auction has no buyout price; place a bid.');
            }

            if ($listing->current_bidder_id !== null) {
                $this->refundBid($listing);
            }
            $fee = $this->fee($price);
            $legs = [
                new Leg($this->ledger->walletFor($buyer, $listing->currency)->account, -$price),
                new Leg($this->ledger->walletFor($listing->seller, $listing->currency)->account, $price - $fee),
            ];
            if ($fee > 0) {
                $legs[] = new Leg($this->ledger->systemAccount('fees', $listing->currency), $fee);
            }
            $sale = $this->ledger->post(new Posting(
                type: 'sale',
                reason: "Market purchase of {$listing->count} {$listing->item}",
                idempotencyKey: "market:sale:{$listing->public_id}",
                legs: $legs,
                initiatedBy: $buyer->id,
                referenceType: 'market_listing',
                referenceId: $listing->public_id,
            ));

            $listing->status = 'sold';
            $listing->buyer_id = $buyer->id;
            $listing->version += 1;
            $listing->save();
            $this->deliver($listing, $buyer, 'purchase');
            $this->audit->record(
                action: 'market.buy',
                actor: $buyer,
                subjectType: 'market_listing',
                subjectId: $listing->public_id,
                payload: ['price' => $price, 'fee' => $fee, 'transaction' => $sale->public_id],
            );

            return $listing;
        });
    }

    /** Bid on an auction: the amount is locked in the listing's escrow; the previous bid is refunded. */
    public function bid(User $bidder, MarketListing $listing, int $amount, string $key): MarketListing
    {
        return DB::transaction(function () use ($bidder, $listing, $amount, $key) {
            $listing = MarketListing::query()->lockForUpdate()->findOrFail($listing->id);
            $earlier = MarketBid::query()->where('bidder_id', $bidder->id)->where('bid_key', $key)->first();
            if ($earlier) {
                if ($earlier->listing_id !== $listing->id || $earlier->amount !== $amount) {
                    throw new MarketException('idempotency_conflict', 'This idempotency key was used for a different bid.', 409);
                }
                $listing->wasReplayed = true;

                return $listing;
            }
            $this->assertOpen($listing);
            if ($listing->kind !== 'auction') {
                throw new MarketException('not_auction', 'Only auctions take bids.');
            }
            if ($listing->seller_id === $bidder->id) {
                throw new MarketException('own_listing', 'You cannot bid on your own auction.');
            }
            if ($listing->current_bidder_id === $bidder->id) {
                throw new MarketException('already_highest', 'You already hold the highest bid.');
            }
            $minimum = $this->minimumBid($listing);
            if ($amount < $minimum) {
                throw new MarketException('bid_too_low', "The lowest acceptable bid is {$minimum}.");
            }
            if ($listing->buyout !== null && $amount >= $listing->buyout) {
                throw new MarketException('use_buyout', 'That reaches the buyout price: buy it instead.');
            }

            if ($listing->current_bidder_id !== null) {
                $this->refundBid($listing);
            }
            $lock = $this->ledger->post(new Posting(
                type: 'escrow_lock',
                reason: "Bid on {$listing->count} {$listing->item}",
                idempotencyKey: "market:bid:{$listing->public_id}:".($listing->bid_count + 1),
                legs: [
                    new Leg($this->ledger->walletFor($bidder, $listing->currency)->account, -$amount),
                    new Leg($this->escrow($listing), $amount),
                ],
                initiatedBy: $bidder->id,
                referenceType: 'market_listing',
                referenceId: $listing->public_id,
            ));
            MarketBid::query()->create([
                'listing_id' => $listing->id,
                'bidder_id' => $bidder->id,
                'amount' => $amount,
                'ledger_transaction_id' => $lock->id,
                'bid_key' => $key,
                'created_at' => now(),
            ]);
            $listing->current_bid = $amount;
            $listing->current_bidder_id = $bidder->id;
            $listing->bid_count += 1;
            if ($listing->ends_at->diffInSeconds(now(), true) < self::SNIPE_SECONDS) {
                $listing->ends_at = now()->addSeconds(self::SNIPE_SECONDS);
            }
            $listing->version += 1;
            $listing->save();

            return $listing;
        });
    }

    /** The seller takes the goods back (not once an auction has bids). */
    public function cancel(User $seller, MarketListing $listing): MarketListing
    {
        return DB::transaction(function () use ($seller, $listing) {
            $listing = MarketListing::query()->lockForUpdate()->findOrFail($listing->id);
            if ($listing->seller_id !== $seller->id) {
                throw new MarketException('forbidden', 'That is not your listing.', 403);
            }
            if ($listing->status !== 'open') {
                throw new MarketException('listing_closed', 'That listing is closed.', 409);
            }
            if ($listing->bid_count > 0) {
                throw new MarketException('has_bids', 'An auction with bids runs to its end.', 409);
            }
            $listing->status = 'cancelled';
            $listing->version += 1;
            $listing->save();
            $this->deliver($listing, $seller, 'cancelled');

            return $listing;
        });
    }

    /** Close every listing whose time is up. Returns how many closed. */
    public function settle(?CarbonInterface $now = null): int
    {
        $now ??= now();
        $closed = 0;
        $due = MarketListing::query()->where('status', 'open')->where('ends_at', '<=', $now)->orderBy('id')->pluck('id');
        foreach ($due as $id) {
            $closed += DB::transaction(function () use ($id, $now) {
                $listing = MarketListing::query()->lockForUpdate()->find($id);
                if (! $listing || $listing->status !== 'open' || $listing->ends_at->greaterThan($now)) {
                    return 0;
                }
                if ($listing->kind === 'auction' && $listing->current_bidder_id !== null) {
                    $winner = User::query()->findOrFail($listing->current_bidder_id);
                    $bid = (int) $listing->current_bid;
                    $fee = $this->fee($bid);
                    $legs = [
                        new Leg($this->escrow($listing), -$bid),
                        new Leg($this->ledger->walletFor($listing->seller, $listing->currency)->account, $bid - $fee),
                    ];
                    if ($fee > 0) {
                        $legs[] = new Leg($this->ledger->systemAccount('fees', $listing->currency), $fee);
                    }
                    $this->ledger->post(new Posting(
                        type: 'sale',
                        reason: "Auction of {$listing->count} {$listing->item}",
                        idempotencyKey: "market:sale:{$listing->public_id}",
                        legs: $legs,
                        referenceType: 'market_listing',
                        referenceId: $listing->public_id,
                    ));
                    $listing->status = 'sold';
                    $listing->buyer_id = $winner->id;
                    $this->deliver($listing, $winner, 'auction_won');
                } else {
                    $listing->status = 'expired';
                    $this->deliver($listing, $listing->seller, 'expired');
                }
                $listing->version += 1;
                $listing->save();

                return 1;
            });
        }

        return $closed;
    }

    /**
     * A sale at a player's stall in the world: the game server holds the
     * goods and hands them over once this succeeds. One transaction per
     * `$key`, however often it is asked.
     */
    public function stallSale(User $buyer, User $seller, int $amount, string $key, string $reason, bool $trade = false): LedgerTransaction
    {
        if ($buyer->is($seller)) {
            throw new MarketException('own_listing', 'You cannot buy from your own stall.');
        }
        if ($amount < 1 || $amount > (int) config('platform.market.max_price')) {
            throw new MarketException('bad_price', 'That price is not allowed.');
        }
        $currency = (string) config('platform.market.currency');
        // A direct trade between two players carries no platform fee.
        $fee = $trade ? 0 : $this->fee($amount);
        $legs = [
            new Leg($this->ledger->walletFor($buyer, $currency)->account, -$amount),
            new Leg($this->ledger->walletFor($seller, $currency)->account, $amount - $fee),
        ];
        if ($fee > 0) {
            $legs[] = new Leg($this->ledger->systemAccount('fees', $currency), $fee);
        }

        return $this->ledger->post(new Posting(
            type: $trade ? 'transfer' : 'sale',
            reason: mb_substr($reason, 0, 120),
            idempotencyKey: ($trade ? 'trade:' : 'stall:').$key,
            legs: $legs,
            referenceType: $trade ? 'trade' : 'stall_sale',
            referenceId: $key,
            initiatedBy: $buyer->id,
        ));
    }

    /**
     * Deliveries waiting for these players in a world.
     *
     * @param  list<string>  $players  public ids
     */
    public function pendingDeliveries(string $world, array $players): Collection
    {
        return ItemDelivery::query()
            ->where('world', $world)->where('status', 'pending')
            ->whereIn('user_id', User::query()->whereIn('public_id', $players)->select('id'))
            ->with('user:id,public_id')
            ->orderBy('id')
            ->limit(500)
            ->get();
    }

    /** A game server handed a delivery over. Idempotent. */
    public function acknowledge(ItemDelivery $delivery): ItemDelivery
    {
        return DB::transaction(function () use ($delivery) {
            $delivery = ItemDelivery::query()->lockForUpdate()->findOrFail($delivery->id);
            if ($delivery->status === 'pending') {
                $delivery->status = 'delivered';
                $delivery->delivered_at = now();
                $delivery->save();
            }

            return $delivery;
        });
    }

    private function escrow(MarketListing $listing)
    {
        return $this->ledger->escrowAccount("listing:{$listing->public_id}", $listing->currency);
    }

    private function refundBid(MarketListing $listing): void
    {
        $previous = User::query()->findOrFail($listing->current_bidder_id);
        $this->ledger->post(new Posting(
            type: 'escrow_refund',
            reason: "Outbid on {$listing->count} {$listing->item}",
            idempotencyKey: "market:refund:{$listing->public_id}:{$listing->bid_count}",
            legs: [
                new Leg($this->escrow($listing), -(int) $listing->current_bid),
                new Leg($this->ledger->walletFor($previous, $listing->currency)->account, (int) $listing->current_bid),
            ],
            referenceType: 'market_listing',
            referenceId: $listing->public_id,
        ));
        $listing->current_bid = null;
        $listing->current_bidder_id = null;
    }

    private function assertOpen(MarketListing $listing): void
    {
        if (! $listing->isOpen()) {
            throw new MarketException('listing_closed', 'That listing is closed.', 409);
        }
    }

    private function deliver(MarketListing $listing, User $to, string $reason): void
    {
        ItemDelivery::query()->create([
            'public_id' => (string) Str::ulid(),
            'user_id' => $to->id,
            'world' => $listing->world,
            'item' => $listing->item,
            'count' => $listing->count,
            'durability' => $listing->durability,
            'reason' => $reason,
            'listing_id' => $listing->id,
            'status' => 'pending',
        ]);
    }
}
