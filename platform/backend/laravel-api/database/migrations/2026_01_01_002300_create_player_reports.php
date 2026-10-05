<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Players reporting other players, and what moderators made of it. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('player_reports', function (Blueprint $table) {
            $table->id();
            $table->ulid('public_id')->unique();
            $table->foreignId('reporter_id')->constrained('users');
            $table->foreignId('target_id')->constrained('users');
            // `game` (the /report command) or `web`.
            $table->string('source', 8);
            $table->string('world', 64)->nullable();
            // cheating, griefing, harassment, scam, name, other.
            $table->string('category', 16);
            $table->string('details', 500);
            // What the game server saw: positions, the reported player's last lines.
            $table->json('context')->nullable();
            // open, resolved, dismissed.
            $table->string('status', 12)->default('open');
            $table->foreignId('handled_by')->nullable()->constrained('users');
            $table->string('resolution', 255)->nullable();
            $table->timestamp('handled_at')->nullable();
            $table->timestamps();
            $table->index(['status', 'created_at']);
            $table->index(['target_id', 'status']);
            $table->index(['reporter_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('player_reports');
    }
};
