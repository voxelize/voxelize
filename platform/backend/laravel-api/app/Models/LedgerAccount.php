<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * One balance in one currency. `balance` is a cache of the sum of the
 * account's entries; only LedgerService writes it, under a row lock.
 */
class LedgerAccount extends Model
{
    public const TYPE_WALLET = 'wallet';

    public const TYPE_SYSTEM = 'system';

    public const TYPE_ESCROW = 'escrow';

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'balance' => 'integer',
            'entry_count' => 'integer',
            'allow_negative' => 'boolean',
        ];
    }

    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_user_id');
    }

    public function entries(): HasMany
    {
        return $this->hasMany(LedgerEntry::class, 'account_id');
    }
}
