<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** A right to build a blueprint; `resold` once it passed to someone else. */
class BlueprintLicense extends Model
{
    public $timestamps = false;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['created_at' => 'datetime'];
    }
}
