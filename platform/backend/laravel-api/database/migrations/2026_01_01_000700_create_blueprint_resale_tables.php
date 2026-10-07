<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Licences change hands: a holder lists theirs, a buyer pays, the creator
 * gets a royalty in the same ledger transaction. Licences therefore carry
 * a status; their history is kept append-only in blueprint_provenance.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('blueprints', function (Blueprint $table) {
            // The creator's share of every resale, in basis points.
            $table->unsignedSmallInteger('royalty_bps')->default(1000);
        });

        Schema::table('blueprint_licenses', function (Blueprint $table) {
            // active | resold
            $table->string('status', 16)->default('active')->index();
        });

        Schema::create('blueprint_resales', function (Blueprint $table) {
            $table->id();
            $table->ulid('public_id')->unique();
            $table->foreignId('blueprint_id')->constrained('blueprints')->restrictOnDelete();
            $table->foreignId('license_id')->constrained('blueprint_licenses')->restrictOnDelete();
            $table->foreignId('seller_id')->constrained('users')->restrictOnDelete();
            $table->unsignedBigInteger('price');
            // open | sold | cancelled
            $table->string('status', 16)->index();
            $table->foreignId('buyer_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestamps();

            $table->index(['blueprint_id', 'status']);
        });

        // Append-only: every licence ever minted or resold.
        Schema::create('blueprint_provenance', function (Blueprint $table) {
            $table->id();
            $table->foreignId('blueprint_id')->constrained('blueprints')->restrictOnDelete();
            // minted | resold
            $table->string('event', 16);
            $table->foreignId('from_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->foreignId('to_id')->constrained('users')->restrictOnDelete();
            $table->unsignedInteger('edition')->nullable();
            $table->unsignedBigInteger('price');
            $table->unsignedBigInteger('royalty')->default(0);
            $table->foreignId('ledger_transaction_id')->nullable()->constrained('ledger_transactions')->restrictOnDelete();
            $table->timestamp('created_at');

            $table->index(['blueprint_id', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('blueprint_provenance');
        Schema::dropIfExists('blueprint_resales');
        Schema::table('blueprint_licenses', fn (Blueprint $table) => $table->dropColumn('status'));
        Schema::table('blueprints', fn (Blueprint $table) => $table->dropColumn('royalty_bps'));
    }
};
