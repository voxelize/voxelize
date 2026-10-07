<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Custom guild ranks (a title and permissions on top of the three roles)
 * and lands captured in war by a siege.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('guild_ranks', function (Blueprint $table) {
            $table->id();
            $table->ulid('public_id')->unique();
            $table->foreignId('guild_id')->constrained('guilds')->cascadeOnDelete();
            $table->string('name', 24);
            // invite | kick | treasury | land | contracts
            $table->json('permissions');
            $table->unsignedSmallInteger('position')->default(0);
            $table->timestamps();

            $table->unique(['guild_id', 'name']);
        });

        Schema::table('guild_members', function (Blueprint $table) {
            $table->foreignId('rank_id')->nullable()->after('role')->constrained('guild_ranks')->nullOnDelete();
        });

        Schema::create('war_captures', function (Blueprint $table) {
            $table->id();
            $table->foreignId('relation_id')->constrained('guild_relations')->cascadeOnDelete();
            $table->foreignId('land_id')->constrained('lands')->restrictOnDelete();
            $table->foreignId('attacker_guild_id')->constrained('guilds')->restrictOnDelete();
            $table->foreignId('defender_guild_id')->constrained('guilds')->restrictOnDelete();
            // The game server's siege id: a capture counts once.
            $table->string('capture_key', 100)->unique();
            $table->timestamp('created_at')->useCurrent();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('war_captures');
        Schema::table('guild_members', function (Blueprint $table) {
            $table->dropConstrainedForeignId('rank_id');
        });
        Schema::dropIfExists('guild_ranks');
    }
};
