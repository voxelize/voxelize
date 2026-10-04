<?php

namespace App\Models;

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
            'password' => 'hashed',
            'roles' => 'array',
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

    public function isActive(): bool
    {
        return $this->status === self::STATUS_ACTIVE;
    }

    public function wallets(): HasMany
    {
        return $this->hasMany(Wallet::class);
    }
}
