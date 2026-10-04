<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Friends (a request, then accepted) and when players were last seen in game. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('friendships', function (Blueprint $table) {
            $table->id();
            // Who asked and who was asked.
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('friend_id')->constrained('users')->cascadeOnDelete();
            // pending | accepted
            $table->string('status', 16);
            $table->timestamp('accepted_at')->nullable();
            $table->timestamps();

            $table->unique(['user_id', 'friend_id']);
            $table->index(['friend_id', 'status']);
        });

        Schema::table('users', function (Blueprint $table) {
            // Game servers report who is online every half minute.
            $table->timestamp('last_seen_at')->nullable();
            $table->string('last_world', 64)->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('friendships');
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['last_seen_at', 'last_world']);
        });
    }
};
