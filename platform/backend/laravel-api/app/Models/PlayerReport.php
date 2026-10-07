<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PlayerReport extends Model
{
    public const OPEN = 'open';

    public const RESOLVED = 'resolved';

    public const DISMISSED = 'dismissed';

    public const CATEGORIES = ['cheating', 'griefing', 'harassment', 'scam', 'name', 'other'];

    protected $guarded = [];

    protected function casts(): array
    {
        return ['context' => 'array', 'handled_at' => 'datetime'];
    }

    public function reporter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reporter_id');
    }

    public function target(): BelongsTo
    {
        return $this->belongsTo(User::class, 'target_id');
    }

    public function handler(): BelongsTo
    {
        return $this->belongsTo(User::class, 'handled_by');
    }
}
