<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class BlueprintResale extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['price' => 'integer'];
    }

    public function design(): BelongsTo
    {
        return $this->belongsTo(BlueprintDesign::class, 'blueprint_id');
    }

    public function seller(): BelongsTo
    {
        return $this->belongsTo(User::class, 'seller_id');
    }
}
