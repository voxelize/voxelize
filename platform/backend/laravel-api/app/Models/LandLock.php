<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** One row per (world, dimension), locked while claims there change. */
class LandLock extends Model
{
    public $timestamps = false;

    protected $guarded = [];
}
