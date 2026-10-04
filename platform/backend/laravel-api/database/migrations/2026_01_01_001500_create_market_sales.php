<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Every completed market sale (whole listings, parts of stacks and won
 * auctions): the price history players look up per item.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('market_sales', function (Blueprint $table) {
            $table->id();
            $table->foreignId('listing_id')->constrained('market_listings')->restrictOnDelete();
            $table->string('world', 64);
            $table->string('item', 64);
            $table->unsignedInteger('count');
            // What the buyer paid for these items (minor units).
            $table->unsignedBigInteger('price');
            $table->string('currency', 8);
            $table->foreignId('buyer_id')->constrained('users')->restrictOnDelete();
            // Idempotency-Key of a partial purchase: answered once.
            $table->string('sale_key', 100)->nullable();
            $table->timestamp('created_at');

            $table->index(['world', 'item', 'created_at']);
            $table->unique(['buyer_id', 'sale_key']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('market_sales');
    }
};
