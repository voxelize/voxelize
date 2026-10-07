<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class MarketListing extends Model
{
    protected $guarded = [];

    public bool $wasReplayed = false;

    protected function casts(): array
    {
        return [
            'count' => 'integer',
            'durability' => 'integer',
            'price' => 'integer',
            'buyout' => 'integer',
            'current_bid' => 'integer',
            'bid_count' => 'integer',
            'ends_at' => 'datetime',
        ];
    }

    public function seller(): BelongsTo
    {
        return $this->belongsTo(User::class, 'seller_id');
    }

    public function buyer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'buyer_id');
    }

    public function currentBidder(): BelongsTo
    {
        return $this->belongsTo(User::class, 'current_bidder_id');
    }

    public function isOpen(): bool
    {
        return $this->status === 'open' && $this->ends_at->isFuture();
    }
}
