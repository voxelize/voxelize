<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Currencies are reference data every environment needs, so they ship as a
 * migration rather than a seeder (docs/ECONOMY_LEDGER.md, "Currencies").
 */
return new class extends Migration
{
    public function up(): void
    {
        $now = now();
        DB::table('currencies')->insert([
            // The soft currency of survival worlds, earned only by playing.
            ['code' => 'CRN', 'name' => 'Crowns', 'realm' => 'survival', 'scale' => 0,
                'is_premium' => false, 'is_transferable' => true, 'created_at' => $now, 'updated_at' => $now],
            // Premium currency: architecture only, no purchase flow exists.
            ['code' => 'GEM', 'name' => 'Gems', 'realm' => 'survival', 'scale' => 0,
                'is_premium' => true, 'is_transferable' => false, 'created_at' => $now, 'updated_at' => $now],
            // Creative worlds get their own play money, worth nothing in survival.
            ['code' => 'CRT', 'name' => 'Creative Credits', 'realm' => 'creative', 'scale' => 0,
                'is_premium' => false, 'is_transferable' => false, 'created_at' => $now, 'updated_at' => $now],
        ]);
    }

    public function down(): void
    {
        DB::table('currencies')->whereIn('code', ['CRN', 'GEM', 'CRT'])->delete();
    }
};
