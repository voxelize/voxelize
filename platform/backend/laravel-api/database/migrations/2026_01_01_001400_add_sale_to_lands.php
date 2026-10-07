<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('lands', function (Blueprint $table) {
            // Asking price while the owner offers the land for sale (minor units).
            $table->unsignedBigInteger('sale_price')->nullable();
            // Idempotency keys of the last resize and purchase.
            $table->string('resize_key', 64)->nullable();
            $table->string('sale_key', 64)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('lands', function (Blueprint $table) {
            $table->dropColumn(['sale_price', 'resize_key', 'sale_key']);
        });
    }
};
