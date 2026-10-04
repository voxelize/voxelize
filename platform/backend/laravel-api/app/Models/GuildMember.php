<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class GuildMember extends Model
{
    protected $guarded = [];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function guild(): BelongsTo
    {
        return $this->belongsTo(Guild::class);
    }

    public function rank(): BelongsTo
    {
        return $this->belongsTo(GuildRank::class);
    }

    /** @return list<string> */
    public function permissions(): array
    {
        if (in_array($this->role, ['leader', 'officer'], true)) {
            return Guild::PERMISSIONS;
        }

        return array_values(array_intersect(Guild::PERMISSIONS, (array) ($this->rank?->permissions ?? [])));
    }

    /** The land role a guild member has on guild land. */
    public function landRole(): string
    {
        return match (true) {
            $this->role === 'leader' => 'owner',
            in_array('land', $this->permissions(), true) => 'manager',
            default => 'builder',
        };
    }
}
