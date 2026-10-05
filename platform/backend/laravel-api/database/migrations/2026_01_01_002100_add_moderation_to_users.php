<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Moderation: why an account is suspended or banned, and chat mutes. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('status_reason', 255)->nullable();
            $table->timestamp('muted_until')->nullable();
            $table->string('mute_reason', 255)->nullable();
            // When status or mute last changed: game servers fetch changes.
            $table->timestamp('sanctioned_at')->nullable()->index();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropIndex(['sanctioned_at']);
            $table->dropColumn(['status_reason', 'muted_until', 'mute_reason', 'sanctioned_at']);
        });
    }
};
