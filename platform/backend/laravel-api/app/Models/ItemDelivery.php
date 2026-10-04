<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Goods the backend owes a player in a world, until a game server hands them over. */
class ItemDelivery extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'count' => 'integer',
            'durability' => 'integer',
            'delivered_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
