<?php

namespace App\Console\Commands;

use App\Services\Market\MarketService;
use Illuminate\Console\Command;

class MarketSettle extends Command
{
    protected $signature = 'market:settle';

    protected $description = 'Close listings whose time is up: pay auction sellers, deliver goods to winners or back to sellers';

    public function handle(MarketService $market): int
    {
        $closed = $market->settle();
        $this->info("Closed {$closed} listing(s).");

        return self::SUCCESS;
    }
}
