<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class GuildRank extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['permissions' => 'array', 'position' => 'integer'];
    }
}
