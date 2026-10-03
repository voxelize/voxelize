<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Double-entry ledger for in-game currencies (docs/ECONOMY_LEDGER.md).
 *
 * Amounts are signed 64-bit integers in minor units; floats never touch
 * money. A transaction's entries sum to zero per currency. Entries are
 * append-only: corrections are new reversing transactions, never updates.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('currencies', function (Blueprint $table) {
            $table->string('code', 8)->primary();
            $table->string('name', 64);
            // Economy realm: survival and creative never exchange value.
            $table->string('realm', 16)->index();
            // Decimal places of the display unit (0 = whole coins).
            $table->unsignedTinyInteger('scale')->default(0);
            $table->boolean('is_premium')->default(false);
            // Whether players may transfer it to each other.
            $table->boolean('is_transferable')->default(true);
            $table->timestamps();
        });

        Schema::create('ledger_accounts', function (Blueprint $table) {
            $table->id();
            // Unique, human readable: "user:<public_id>:CRN", "system:mint:CRN".
            $table->string('code', 120)->unique();
            $table->string('type', 16)->index(); // wallet | system | escrow
            $table->string('currency', 8);
            $table->foreign('currency')->references('code')->on('currencies')->restrictOnDelete();
            $table->foreignId('owner_user_id')->nullable()->constrained('users')->restrictOnDelete();
            // Only system source accounts (mint) may go below zero.
            $table->boolean('allow_negative')->default(false);
            // Cached sum of this account's entries; maintained under row lock
            // and checked by `ledger:verify`.
            $table->bigInteger('balance')->default(0);
            $table->unsignedBigInteger('entry_count')->default(0);
            $table->timestamps();

            $table->index(['owner_user_id', 'currency']);
        });

        Schema::create('wallets', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->restrictOnDelete();
            $table->string('currency', 8);
            $table->foreign('currency')->references('code')->on('currencies')->restrictOnDelete();
            $table->foreignId('ledger_account_id')->unique()->constrained('ledger_accounts')->restrictOnDelete();
            $table->timestamps();

            $table->unique(['user_id', 'currency']);
        });

        Schema::create('ledger_transactions', function (Blueprint $table) {
            $table->id();
            $table->ulid('public_id')->unique();
            // What happened: transfer | mint | burn | fee | escrow_lock | ...
            $table->string('type', 32)->index();
            $table->string('reason', 255);
            // What it is about (a trade, a marketplace order...).
            $table->string('reference_type', 64)->nullable();
            $table->string('reference_id', 64)->nullable();
            // Client- or service-supplied key; a repeat returns this row.
            $table->string('idempotency_key', 120)->unique();
            // sha256 of the request that created it, to refuse a key reused
            // for a different request.
            $table->char('request_hash', 64);
            $table->foreignId('initiated_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->json('metadata')->nullable();
            $table->timestamp('created_at')->useCurrent()->index();

            $table->index(['reference_type', 'reference_id']);
        });

        Schema::create('ledger_entries', function (Blueprint $table) {
            $table->id();
            $table->foreignId('transaction_id')->constrained('ledger_transactions')->restrictOnDelete();
            $table->foreignId('account_id')->constrained('ledger_accounts')->restrictOnDelete();
            $table->string('currency', 8);
            // Positive increases the account balance, negative decreases it.
            $table->bigInteger('amount');
            // Account balance right after this entry: the "balance state".
            $table->bigInteger('balance_after');
            $table->timestamp('created_at')->useCurrent();

            $table->index(['account_id', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ledger_entries');
        Schema::dropIfExists('ledger_transactions');
        Schema::dropIfExists('wallets');
        Schema::dropIfExists('ledger_accounts');
        Schema::dropIfExists('currencies');
    }
};
