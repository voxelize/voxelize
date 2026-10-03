<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Every game ticket issued, for audit and abuse investigation. The ticket
 * string itself is never stored: only its id and claims.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('game_tickets', function (Blueprint $table) {
            $table->id();
            $table->string('jti', 64)->unique();
            $table->foreignId('user_id')->constrained('users')->restrictOnDelete();
            $table->string('world', 64);
            $table->string('realm', 16);
            $table->timestamp('issued_at');
            $table->timestamp('expires_at')->index();
            $table->string('ip_address', 45)->nullable();

            $table->index(['user_id', 'issued_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('game_tickets');
    }
};
