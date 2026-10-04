<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Guilds: members with roles, a treasury (the ledger account
 * `guild:<public_id>:<CUR>`), and land held by the guild.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('guilds', function (Blueprint $table) {
            $table->id();
            $table->ulid('public_id')->unique();
            $table->string('name', 32)->unique();
            $table->string('tag', 5)->unique();
            $table->foreignId('leader_id')->constrained('users')->restrictOnDelete();
            // active | disbanded
            $table->string('status', 16)->default('active')->index();
            $table->string('create_key', 100);
            $table->timestamps();

            $table->unique(['leader_id', 'create_key']);
        });

        Schema::create('guild_members', function (Blueprint $table) {
            $table->id();
            $table->foreignId('guild_id')->constrained('guilds')->restrictOnDelete();
            // One guild per player.
            $table->foreignId('user_id')->unique()->constrained('users')->restrictOnDelete();
            // leader | officer | member
            $table->string('role', 16);
            $table->timestamps();
        });

        Schema::create('guild_invites', function (Blueprint $table) {
            $table->id();
            $table->foreignId('guild_id')->constrained('guilds')->restrictOnDelete();
            $table->foreignId('user_id')->constrained('users')->restrictOnDelete();
            $table->foreignId('invited_by')->constrained('users')->restrictOnDelete();
            $table->timestamps();

            $table->unique(['guild_id', 'user_id']);
        });

        Schema::table('lands', function (Blueprint $table) {
            $table->foreignId('guild_id')->nullable()->after('owner_id')->constrained('guilds')->restrictOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('lands', function (Blueprint $table) {
            $table->dropConstrainedForeignId('guild_id');
        });
        Schema::dropIfExists('guild_invites');
        Schema::dropIfExists('guild_members');
        Schema::dropIfExists('guilds');
    }
};
