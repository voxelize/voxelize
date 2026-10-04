<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Player marketplace (docs/ERD.md "Marketplace"). Listed goods are in the
 * backend's custody from the moment a listing exists until a delivery
 * hands them to a buyer or back to the seller; a game server applies each
 * delivery once (it remembers delivered ids with the player's inventory).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('market_listings', function (Blueprint $table) {
            $table->id();
            $table->ulid('public_id')->unique();
            $table->foreignId('seller_id')->constrained('users')->restrictOnDelete();
            $table->string('world', 64);
            // fixed | auction
            $table->string('kind', 16);
            // Content item key, count and remaining durability of the goods.
            $table->string('item', 64);
            $table->unsignedInteger('count');
            $table->unsignedInteger('durability')->nullable();
            $table->string('currency', 8);
            // Fixed: the price. Auction: the opening bid.
            $table->unsignedBigInteger('price');
            $table->unsignedBigInteger('buyout')->nullable();
            $table->unsignedBigInteger('current_bid')->nullable();
            $table->foreignId('current_bidder_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->unsignedInteger('bid_count')->default(0);
            // open | sold | cancelled | expired
            $table->string('status', 16)->index();
            $table->foreignId('buyer_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestamp('ends_at')->index();
            // The game server's outbox id: a retried listing is created once.
            $table->string('listing_key', 100)->unique();
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();

            $table->index(['world', 'status', 'item']);
            $table->index(['seller_id', 'status']);
        });

        // Append-only: every bid ever placed and the escrow lock it made.
        Schema::create('market_bids', function (Blueprint $table) {
            $table->id();
            $table->foreignId('listing_id')->constrained('market_listings')->restrictOnDelete();
            $table->foreignId('bidder_id')->constrained('users')->restrictOnDelete();
            $table->unsignedBigInteger('amount');
            $table->foreignId('ledger_transaction_id')->constrained('ledger_transactions')->restrictOnDelete();
            // The bidder's Idempotency-Key: a retried bid is answered, not placed twice.
            $table->string('bid_key', 100);
            $table->timestamp('created_at');

            $table->index(['listing_id', 'id']);
            $table->unique(['bidder_id', 'bid_key']);
        });

        // Goods owed to a player in a world; game servers hand them over.
        Schema::create('item_deliveries', function (Blueprint $table) {
            $table->id();
            $table->ulid('public_id')->unique();
            $table->foreignId('user_id')->constrained('users')->restrictOnDelete();
            $table->string('world', 64);
            $table->string('item', 64);
            $table->unsignedInteger('count');
            $table->unsignedInteger('durability')->nullable();
            // purchase | auction_won | cancelled | expired
            $table->string('reason', 32);
            $table->foreignId('listing_id')->nullable()->constrained('market_listings')->restrictOnDelete();
            // pending | delivered
            $table->string('status', 16);
            $table->timestamp('delivered_at')->nullable();
            $table->timestamps();

            $table->index(['world', 'status', 'user_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('item_deliveries');
        Schema::dropIfExists('market_bids');
        Schema::dropIfExists('market_listings');
    }
};
