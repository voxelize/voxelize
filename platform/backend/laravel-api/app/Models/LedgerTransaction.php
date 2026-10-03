<?php

namespace App\Models;

use App\Models\Concerns\AppendOnly;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class LedgerTransaction extends Model
{
    use AppendOnly;

    public const UPDATED_AT = null;

    protected $guarded = [];

    /** Set by LedgerService when a request was answered from an earlier post. */
    public bool $wasReplayed = false;

    protected function casts(): array
    {
        return ['metadata' => 'array'];
    }

    public function entries(): HasMany
    {
        return $this->hasMany(LedgerEntry::class, 'transaction_id');
    }
}
