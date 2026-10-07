<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Blueprints: a building captured in the game (layout in object storage,
 * bill of materials here), sold as licences that let the buyer build it
 * from their own materials. The creator is paid in the same ledger
 * transaction as the platform fee.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('blueprints', function (Blueprint $table) {
            $table->id();
            $table->ulid('public_id')->unique();
            $table->foreignId('creator_id')->constrained('users')->restrictOnDelete();
            $table->string('world', 64);
            $table->string('name', 64);
            $table->unsignedSmallInteger('size_x');
            $table->unsignedSmallInteger('size_y');
            $table->unsignedSmallInteger('size_z');
            $table->unsignedInteger('block_count');
            // Content item key => count needed to build it.
            $table->json('materials');
            $table->string('storage_disk', 16);
            $table->string('storage_path', 191);
            $table->char('sha256', 64);
            $table->unsignedInteger('bytes');
            // draft | published | rejected
            $table->string('status', 16)->index();
            $table->unsignedBigInteger('price')->nullable();
            // Limited editions: at most this many licences are sold.
            $table->unsignedInteger('max_copies')->nullable();
            $table->unsignedInteger('copies_sold')->default(0);
            $table->string('upload_key', 100)->unique();
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();

            $table->index(['world', 'status']);
            $table->index(['creator_id', 'id']);
        });

        // Append-only: who may build which blueprint, and the sale that gave it.
        Schema::create('blueprint_licenses', function (Blueprint $table) {
            $table->id();
            $table->foreignId('blueprint_id')->constrained('blueprints')->restrictOnDelete();
            $table->foreignId('user_id')->constrained('users')->restrictOnDelete();
            $table->unsignedInteger('edition')->nullable();
            $table->foreignId('ledger_transaction_id')->nullable()->constrained('ledger_transactions')->restrictOnDelete();
            $table->timestamp('created_at');

            $table->unique(['blueprint_id', 'user_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('blueprint_licenses');
        Schema::dropIfExists('blueprints');
    }
};
