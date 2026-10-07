<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Worlds players create, who may join them, and what game servers report. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('worlds', function (Blueprint $table) {
            $table->id();
            // The world's key: tickets, game servers (GAME_WORLD_NAME) and saves use it.
            $table->string('public_id', 32)->unique();
            $table->string('name', 32);
            $table->foreignId('owner_id')->constrained('users')->cascadeOnDelete();
            // public | friends (the owner's) | private (members only)
            $table->string('visibility', 16);
            // survival | creative
            $table->string('realm', 16);
            $table->unsignedSmallInteger('max_players');
            // Where its game server listens, once one hosts it.
            $table->string('url', 255)->nullable();
            // active | archived
            $table->string('status', 16);
            $table->timestamps();

            $table->index(['owner_id', 'status']);
            $table->index(['visibility', 'status']);
        });

        Schema::create('world_members', function (Blueprint $table) {
            $table->id();
            $table->foreignId('world_id')->constrained('worlds')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->timestamp('created_at');

            $table->unique(['world_id', 'user_id']);
        });

        // One row per world and dimension, refreshed by its game server.
        Schema::create('world_status', function (Blueprint $table) {
            $table->id();
            $table->string('world', 64);
            $table->string('dimension', 32);
            $table->unsignedInteger('players');
            $table->timestamp('seen_at');

            $table->unique(['world', 'dimension']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('world_status');
        Schema::dropIfExists('world_members');
        Schema::dropIfExists('worlds');
    }
};
