<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Versioned blueprints: every layout a creator uploads for a design is a
 * revision; licence holders build the newest. Publishing (and a new
 * revision of a published design) waits for review when review is required.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('blueprints', function (Blueprint $table) {
            $table->unsignedInteger('revision')->default(1);
            // Why a review sent the design back to draft.
            $table->string('review_note', 255)->nullable();
        });
        Schema::create('blueprint_revisions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('blueprint_id')->constrained('blueprints')->restrictOnDelete();
            $table->unsignedInteger('revision');
            $table->string('storage_path', 255);
            $table->char('sha256', 64);
            $table->unsignedInteger('bytes');
            $table->unsignedSmallInteger('size_x');
            $table->unsignedSmallInteger('size_y');
            $table->unsignedSmallInteger('size_z');
            $table->unsignedInteger('block_count');
            $table->json('materials');
            // The game server's upload key: a retried upload is stored once.
            $table->string('upload_key', 100)->unique();
            $table->timestamp('created_at');

            $table->unique(['blueprint_id', 'revision']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('blueprint_revisions');
        Schema::table('blueprints', function (Blueprint $table) {
            $table->dropColumn(['revision', 'review_note']);
        });
    }
};
