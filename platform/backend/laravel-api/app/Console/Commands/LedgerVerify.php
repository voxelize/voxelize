<?php

namespace App\Console\Commands;

use App\Services\Economy\EconomyFreeze;
use App\Services\Economy\LedgerService;
use Illuminate\Console\Command;

class LedgerVerify extends Command
{
    protected $signature = 'ledger:verify {--no-freeze : Report only; do not freeze the economy}';

    protected $description = 'Check that every transaction balances and every cached balance matches its entries';

    public function handle(LedgerService $ledger, EconomyFreeze $freeze): int
    {
        $problems = $ledger->verify();
        if ($problems === []) {
            $this->info('Ledger is consistent.');

            return self::SUCCESS;
        }
        foreach ($problems as $problem) {
            $this->error($problem);
        }
        if (! $this->option('no-freeze')) {
            $freeze->freeze($problems);
            $this->error('Economy frozen until an administrator releases it.');
        }

        return self::FAILURE;
    }
}
