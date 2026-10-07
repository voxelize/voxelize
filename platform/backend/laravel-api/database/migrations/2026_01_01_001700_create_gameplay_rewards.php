<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Crowns game servers pay for jobs and quests (minted, capped per day). */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('gameplay_rewards', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->restrictOnDelete();
            $table->string('world', 64);
            // job | quest
            $table->string('source', 16);
            $table->string('reason', 120);
            // What was asked and what was paid after the daily cap.
            $table->unsignedBigInteger('requested');
            $table->unsignedBigInteger('paid');
            $table->foreignId('ledger_transaction_id')->nullable()->constrained('ledger_transactions')->restrictOnDelete();
            // The game server's key: a retried reward is paid once.
            $table->string('reward_key', 100)->unique();
            $table->timestamp('created_at');

            $table->index(['user_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('gameplay_rewards');
    }
};
