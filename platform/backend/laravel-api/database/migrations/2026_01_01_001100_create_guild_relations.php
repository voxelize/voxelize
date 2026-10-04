<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Guild diplomacy and taxes: alliances (proposed, then active once the other
 * leader accepts) and wars (declared by a leader, fought after a warm-up,
 * scored by kills, ended by peace both leaders agree to or by time), and a
 * sales tax a guild levies on stalls standing on its land.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('guilds', function (Blueprint $table) {
            // Basis points of every stall sale on the guild's land.
            $table->unsignedSmallInteger('tax_bps')->default(0)->after('status');
        });

        Schema::create('guild_relations', function (Blueprint $table) {
            $table->id();
            $table->ulid('public_id')->unique();
            // The pair, lower id first: one relation per pair of guilds.
            $table->foreignId('guild_a_id')->constrained('guilds')->restrictOnDelete();
            $table->foreignId('guild_b_id')->constrained('guilds')->restrictOnDelete();
            // alliance | war
            $table->string('kind', 16);
            // proposed | active (alliances); active (wars)
            $table->string('status', 16);
            // The guild that proposed the alliance or declared the war.
            $table->foreignId('initiator_id')->constrained('guilds')->restrictOnDelete();
            // Wars: fighting starts at, ends at the latest at.
            $table->timestamp('starts_at')->nullable();
            $table->timestamp('ends_at')->nullable();
            $table->unsignedInteger('score_a')->default(0);
            $table->unsignedInteger('score_b')->default(0);
            // Wars: the guild that offered peace, waiting for the other.
            $table->foreignId('peace_offered_by')->nullable()->constrained('guilds')->restrictOnDelete();
            $table->timestamps();

            $table->unique(['guild_a_id', 'guild_b_id']);
        });

        // Kills counted once each (the game server's kill id).
        Schema::create('war_kills', function (Blueprint $table) {
            $table->id();
            $table->foreignId('relation_id')->constrained('guild_relations')->cascadeOnDelete();
            $table->string('kill_key', 100)->unique();
            $table->foreignId('killer_id')->constrained('users')->restrictOnDelete();
            $table->foreignId('victim_id')->constrained('users')->restrictOnDelete();
            $table->timestamp('created_at')->useCurrent();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('war_kills');
        Schema::dropIfExists('guild_relations');
        Schema::table('guilds', function (Blueprint $table) {
            $table->dropColumn('tax_bps');
        });
    }
};
