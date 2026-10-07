<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Cosmetics players bought, and what each wears. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('cosmetic_unlocks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            // A key of platform.cosmetics.catalog.
            $table->string('cosmetic', 64);
            $table->unsignedBigInteger('price');
            $table->foreignId('ledger_transaction_id')->nullable()->constrained('ledger_transactions')->restrictOnDelete();
            $table->timestamp('created_at');

            $table->unique(['user_id', 'cosmetic']);
        });

        Schema::table('users', function (Blueprint $table) {
            // Slot => cosmetic key, e.g. {"outfit": "outfit_ranger", "hat": "hat_crown"}.
            $table->json('cosmetics')->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cosmetic_unlocks');
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('cosmetics');
        });
    }
};
