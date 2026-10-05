<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * What each player carries and where they are, per world, written by the
 * world's game server (GAME_DATABASE_URL): the full record as JSON, plus the
 * parts admins and queries need as columns.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('player_states', function (Blueprint $table) {
            $table->id();
            // The world (GAME_WORLD_NAME), every dimension of it sharing a record.
            $table->string('world', 64);
            // The player's public id (users.public_id).
            $table->string('player', 64);
            $table->string('dimension', 32);
            $table->unsignedInteger('record_version');
            $table->json('record');
            $table->float('health')->nullable();
            $table->unsignedInteger('xp')->default(0);
            $table->float('x')->nullable();
            $table->float('y')->nullable();
            $table->float('z')->nullable();
            // Bumped on every write: a stale writer never overwrites newer data.
            $table->unsignedBigInteger('revision')->default(0);
            $table->timestamp('updated_at')->nullable();

            $table->unique(['world', 'player']);
            $table->index('player');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('player_states');
    }
};
