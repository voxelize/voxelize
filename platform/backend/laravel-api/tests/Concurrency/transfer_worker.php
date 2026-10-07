<?php

/*
 * Worker for LedgerConcurrencyTest: boots the application and fires
 * transfers between the test players as fast as it can. Some idempotency
 * keys are shared between workers on purpose, so duplicates race too.
 *
 * Usage: php transfer_worker.php <worker-number> <transfers>
 */

use App\Models\User;
use App\Services\Economy\EconomyException;
use App\Services\Economy\LedgerService;
use Illuminate\Contracts\Console\Kernel;

require __DIR__.'/../../vendor/autoload.php';
$app = require __DIR__.'/../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

[$worker, $count] = [(int) $argv[1], (int) $argv[2]];
$ledger = $app->make(LedgerService::class);
$players = User::query()->whereIn('username', ['race_a', 'race_b', 'race_c'])->orderBy('username')->get()->values();

$outcomes = ['ok' => 0, 'replayed' => 0, 'insufficient' => 0];
for ($i = 0; $i < $count; $i++) {
    $from = $players[($worker + $i) % 3];
    $to = $players[($worker + $i + 1) % 3];
    // Every fourth key is shared by all workers: only one may pay.
    $key = $i % 4 === 0 ? "shared-{$i}" : "w{$worker}-{$i}";
    try {
        $transaction = $ledger->transfer($from, $to, 'CRN', 7, $key);
        $outcomes[$transaction->wasReplayed ? 'replayed' : 'ok']++;
    } catch (EconomyException $e) {
        if ($e->errorCode === 'insufficient_funds') {
            $outcomes['insufficient']++;
        } elseif ($e->errorCode !== 'idempotency_conflict') {
            throw $e;
        }
    }
}

echo json_encode($outcomes), "\n";
