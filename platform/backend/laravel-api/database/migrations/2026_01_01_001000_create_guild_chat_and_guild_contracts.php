<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Guild chat, and contracts posted by a guild (the reward locked from its
 * treasury and refunded to it).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('guild_messages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('guild_id')->constrained('guilds')->restrictOnDelete();
            $table->foreignId('user_id')->constrained('users')->restrictOnDelete();
            $table->string('body', 300);
            $table->timestamp('created_at')->useCurrent();

            $table->index(['guild_id', 'id']);
        });

        Schema::table('contracts', function (Blueprint $table) {
            $table->foreignId('guild_id')->nullable()->after('poster_id')->constrained('guilds')->restrictOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('contracts', function (Blueprint $table) {
            $table->dropConstrainedForeignId('guild_id');
        });
        Schema::dropIfExists('guild_messages');
    }
};
