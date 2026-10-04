<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** A captured building (table `blueprints`). */
class BlueprintDesign extends Model
{
    protected $table = 'blueprints';

    protected $guarded = [];

    public bool $wasReplayed = false;

    protected function casts(): array
    {
        return [
            'materials' => 'array',
            'price' => 'integer',
            'max_copies' => 'integer',
            'copies_sold' => 'integer',
        ];
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'creator_id');
    }

    public function licenses(): HasMany
    {
        return $this->hasMany(BlueprintLicense::class, 'blueprint_id');
    }

    public function mayBuild(User $user): bool
    {
        return $this->status !== 'rejected'
            && ($this->creator_id === $user->id || $this->licenses()->where('user_id', $user->id)->exists());
    }
}
