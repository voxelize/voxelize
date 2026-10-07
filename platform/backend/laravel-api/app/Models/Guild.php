<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Guild extends Model
{
    public const ROLES = ['leader', 'officer', 'member'];

    /**
     * What a member may do beyond depositing: invite players, remove
     * members, pay out of the treasury, claim and manage guild land, post
     * guild contracts. The leader may do everything, officers all of these;
     * members only what their rank grants.
     */
    public const PERMISSIONS = ['invite', 'kick', 'treasury', 'land', 'contracts'];

    protected $guarded = [];

    public bool $wasReplayed = false;

    protected function casts(): array
    {
        return ['tax_bps' => 'integer'];
    }

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

    public function ranks(): HasMany
    {
        return $this->hasMany(GuildRank::class)->orderBy('position')->orderBy('id');
    }

    /** @return list<string> what `$user` may do in this guild */
    public function permissionsOf(User $user): array
    {
        $member = $this->status === 'active'
            ? $this->members()->where('user_id', $user->id)->with('rank')->first()
            : null;

        return $member ? $member->permissions() : [];
    }

    public function can(User $user, string $permission): bool
    {
        return in_array($permission, $this->permissionsOf($user), true);
    }
}
