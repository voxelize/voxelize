<?php

namespace App\Models;

use App\Notifications\ResetPasswordLink;
use App\Notifications\VerifyEmailLink;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Str;
use Laravel\Sanctum\HasApiTokens;

#[Fillable(['username', 'email', 'password'])]
#[Hidden(['id', 'password', 'remember_token'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, Notifiable;

    public const STATUS_ACTIVE = 'active';

    public const STATUS_SUSPENDED = 'suspended';

    public const STATUS_BANNED = 'banned';

    /** Deleted by the player: anonymised, kept for the ledger and audit log. */
    public const STATUS_DELETED = 'deleted';

    protected static function booted(): void
    {
        static::creating(function (User $user) {
            $user->public_id ??= (string) Str::ulid();
            $user->status ??= self::STATUS_ACTIVE;
        });
    }

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'last_seen_at' => 'datetime',
            'muted_until' => 'datetime',
            'sanctioned_at' => 'datetime',
            'password' => 'hashed',
            'roles' => 'array',
            'cosmetics' => 'array',
        ];
    }

    /** Roles a user may hold besides "player". */
    public const GRANTABLE_ROLES = ['moderator', 'admin'];

    /** @return list<string> every role, "player" first */
    public function gameRoles(): array
    {
        $extra = array_values(array_intersect(self::GRANTABLE_ROLES, (array) ($this->roles ?? [])));

        return ['player', ...$extra];
    }

    public function hasRole(string ...$roles): bool
    {
        return (bool) array_intersect($roles, $this->gameRoles());
    }

    public function isMuted(): bool
    {
        return $this->muted_until !== null && $this->muted_until->isFuture();
    }

    public function isActive(): bool
    {
        return $this->status === self::STATUS_ACTIVE;
    }

    /** The reset link goes to the web client, which posts the new password. */
    public function sendPasswordResetNotification($token): void
    {
        $this->notify(new ResetPasswordLink($token));
    }

    public function sendEmailVerificationNotification(): void
    {
        $this->notify(new VerifyEmailLink);
    }

    public function wallets(): HasMany
    {
        return $this->hasMany(Wallet::class);
    }
}
