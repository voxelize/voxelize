<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** One uploaded layout of a blueprint design (append-only). */
class BlueprintRevision extends Model
{
    public const UPDATED_AT = null;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['materials' => 'array', 'created_at' => 'datetime'];
    }
}
