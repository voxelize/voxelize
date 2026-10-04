<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A claimed box of whole chunks in one world and dimension, full height.
 */
class Land extends Model
{
    public const ROLES = ['manager', 'builder', 'visitor'];

    /** What non-members may do unless the owner allows more. */
    public const DEFAULT_PERMISSIONS = ['build' => false, 'containers' => false, 'use' => false];

    protected $guarded = [];

    /** Set when a claim was answered from an earlier request with the same key. */
    public bool $wasReplayed = false;

    protected function casts(): array
    {
        return [
            'permissions' => 'array',
        ];
    }

    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_id');
    }

    public function members(): HasMany
    {
        return $this->hasMany(LandMember::class);
    }

    public function chunkCount(): int
    {
        return ($this->max_chunk_x - $this->min_chunk_x + 1) * ($this->max_chunk_z - $this->min_chunk_z + 1);
    }

    public function guild(): BelongsTo
    {
        return $this->belongsTo(Guild::class);
    }

    /** Guild land: the leader owns it, officers manage it, members build. */
    public function roleOf(User $user): ?string
    {
        if ($this->guild_id !== null) {
            $mapped = GuildMember::query()->where('guild_id', $this->guild_id)->where('user_id', $user->id)->with('rank')->first()?->landRole();
            if ($mapped !== null) {
                return $mapped;
            }
        } elseif ($this->owner_id === $user->id) {
            return 'owner';
        }

        return $this->members()->where('user_id', $user->id)->value('role');
    }
}
