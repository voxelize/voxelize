<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Delivery contracts: "bring me N of an item by a deadline". The reward is
 * locked in escrow when the contract is posted, released to the contractor
 * when the goods arrive, refunded when it expires or is cancelled.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('contracts', function (Blueprint $table) {
            $table->id();
            $table->ulid('public_id')->unique();
            $table->foreignId('poster_id')->constrained('users')->restrictOnDelete();
            $table->string('world', 64);
            $table->string('title', 80);
            $table->string('item', 64);
            $table->unsignedInteger('count');
            $table->string('currency', 8);
            $table->unsignedBigInteger('reward');
            // open | accepted | fulfilled | expired | cancelled
            $table->string('status', 16)->index();
            $table->foreignId('contractor_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestamp('accepted_at')->nullable();
            $table->timestamp('deadline_at')->index();
            $table->string('post_key', 100);
            // The game server's outbox id of the delivery that fulfilled it.
            $table->string('fulfil_key', 100)->nullable()->unique();
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();

            $table->unique(['poster_id', 'post_key']);
            $table->index(['world', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('contracts');
    }
};
