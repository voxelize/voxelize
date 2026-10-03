<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Services\Economy\LedgerService;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

/**
 * Creates accounts for load-test bots and prints their API tokens as JSON
 * (platform/tests/bots/load.mjs). Bots cannot register through the API at
 * scale because registration is rate limited per IP, as it should be.
 * Refuses to run in production.
 */
class ProvisionBots extends Command
{
    protected $signature = 'bots:provision {count : How many bot accounts} {--prefix=bot}';

    protected $description = 'Create load-test bot accounts and print their tokens (not in production)';

    public function handle(LedgerService $ledger): int
    {
        if (app()->environment('production')) {
            $this->error('bots:provision is disabled in production.');

            return self::FAILURE;
        }
        $count = (int) $this->argument('count');
        if ($count < 1 || $count > 1000) {
            $this->error('count must be 1-1000.');

            return self::FAILURE;
        }

        $prefix = preg_replace('/[^a-z0-9_]/', '', strtolower((string) $this->option('prefix'))) ?: 'bot';
        $run = strtolower(Str::random(5));
        $bots = [];
        for ($i = 0; $i < $count; $i++) {
            $user = User::create([
                'username' => substr("{$prefix}_{$run}_{$i}", 0, 24),
                'email' => "{$prefix}_{$run}_{$i}@bots.invalid",
                'password' => Str::random(32),
            ]);
            $ledger->walletFor($user, config('platform.economy.soft_currency'));
            $bots[] = ['username' => $user->username, 'token' => $user->createToken('bot')->plainTextToken];
        }
        $this->line(json_encode($bots, JSON_PRETTY_PRINT));

        return self::SUCCESS;
    }
}
