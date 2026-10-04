<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class GuildRelation extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'starts_at' => 'datetime',
            'ends_at' => 'datetime',
            'score_a' => 'integer',
            'score_b' => 'integer',
        ];
    }

    public function guildA(): BelongsTo
    {
        return $this->belongsTo(Guild::class, 'guild_a_id');
    }

    public function guildB(): BelongsTo
    {
        return $this->belongsTo(Guild::class, 'guild_b_id');
    }

    /** The other side of the relation, seen from `$guild`. */
    public function otherId(Guild $guild): int
    {
        return $this->guild_a_id === $guild->id ? $this->guild_b_id : $this->guild_a_id;
    }

    /** A war being fought right now (after its warm-up, before its end). */
    public function fighting(): bool
    {
        return $this->kind === 'war' && $this->status === 'active'
            && $this->starts_at !== null && $this->starts_at->isPast()
            && ($this->ends_at === null || $this->ends_at->isFuture());
    }
}
