<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Guild extends Model
{
    public const ROLES = ['leader', 'officer', 'member'];

    protected $guarded = [];

    public bool $wasReplayed = false;

    public function leader(): BelongsTo
    {
        return $this->belongsTo(User::class, 'leader_id');
    }

    public function members(): HasMany
    {
        return $this->hasMany(GuildMember::class);
    }

    public function invites(): HasMany
    {
        return $this->hasMany(GuildInvite::class);
    }

    public function roleOf(User $user): ?string
    {
        return $this->members()->where('user_id', $user->id)->value('role');
    }
}
