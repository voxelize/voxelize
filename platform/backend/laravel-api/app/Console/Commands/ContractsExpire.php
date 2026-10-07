<?php

namespace App\Console\Commands;

use App\Services\Contract\ContractService;
use Illuminate\Console\Command;

class ContractsExpire extends Command
{
    protected $signature = 'contracts:expire';

    protected $description = 'Refund the locked rewards of contracts past their deadline';

    public function handle(ContractService $contracts): int
    {
        $this->info('Expired '.$contracts->expire().' contract(s).');

        return self::SUCCESS;
    }
}
