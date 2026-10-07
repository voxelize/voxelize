<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** A job or quest payout to a player (append-only). */
class GameplayReward extends Model
{
    public const UPDATED_AT = null;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['created_at' => 'datetime'];
    }
}
