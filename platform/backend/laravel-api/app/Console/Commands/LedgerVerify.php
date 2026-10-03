<?php

namespace App\Console\Commands;

use App\Services\Economy\LedgerService;
use Illuminate\Console\Command;

class LedgerVerify extends Command
{
    protected $signature = 'ledger:verify';

    protected $description = 'Check that every transaction balances and every cached balance matches its entries';

    public function handle(LedgerService $ledger): int
    {
        $problems = $ledger->verify();
        if ($problems === []) {
            $this->info('Ledger is consistent.');

            return self::SUCCESS;
        }
        foreach ($problems as $problem) {
            $this->error($problem);
        }

        return self::FAILURE;
    }
}
