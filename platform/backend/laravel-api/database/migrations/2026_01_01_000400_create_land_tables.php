<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Land ownership (docs/ERD.md "Land and property"). A land is a box of
 * whole chunks in one world and dimension, full height. Overlaps are
 * prevented by the claim service while it holds the (world, dimension) row
 * of `land_locks` FOR UPDATE: MySQL has no exclusion constraints.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('land_locks', function (Blueprint $table) {
            $table->id();
            $table->string('world', 64);
            $table->string('dimension', 16);
            $table->unique(['world', 'dimension']);
        });

        Schema::create('lands', function (Blueprint $table) {
            $table->id();
            $table->ulid('public_id')->unique();
            $table->string('world', 64);
            $table->string('dimension', 16);
            $table->foreignId('owner_id')->constrained('users')->restrictOnDelete();
            $table->string('name', 48);
            $table->integer('min_chunk_x');
            $table->integer('min_chunk_z');
            $table->integer('max_chunk_x');
            $table->integer('max_chunk_z');
            // What players who are not members may do: build, containers, use.
            $table->json('permissions');
            // active | released
            $table->string('status', 16)->index();
            // The claimant's Idempotency-Key, so a retried claim is answered
            // with the land it created instead of claiming twice.
            $table->string('claim_key', 100)->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();

            $table->index(['world', 'dimension', 'status', 'min_chunk_x', 'min_chunk_z']);
            $table->unique(['owner_id', 'claim_key']);
        });

        Schema::create('land_members', function (Blueprint $table) {
            $table->id();
            $table->foreignId('land_id')->constrained('lands')->restrictOnDelete();
            $table->foreignId('user_id')->constrained('users')->restrictOnDelete();
            // manager | builder | visitor (the owner is lands.owner_id)
            $table->string('role', 16);
            $table->timestamps();

            $table->unique(['land_id', 'user_id']);
        });

        // Append-only history of every ownership event.
        Schema::create('land_history', function (Blueprint $table) {
            $table->id();
            $table->foreignId('land_id')->constrained('lands')->restrictOnDelete();
            // claimed | released | member_added | member_removed | updated
            $table->string('event', 24);
            $table->foreignId('actor_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->json('details')->nullable();
            $table->foreignId('ledger_transaction_id')->nullable()->constrained('ledger_transactions')->restrictOnDelete();
            $table->timestamp('created_at');

            $table->index(['land_id', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('land_history');
        Schema::dropIfExists('land_members');
        Schema::dropIfExists('lands');
        Schema::dropIfExists('land_locks');
    }
};
