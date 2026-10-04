<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** One completed sale on the market (append-only). */
class MarketSale extends Model
{
    public const UPDATED_AT = null;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['created_at' => 'datetime'];
    }
}
