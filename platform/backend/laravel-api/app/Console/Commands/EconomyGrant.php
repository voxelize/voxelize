<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Services\Economy\LedgerService;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

/**
 * The only administrative way to create money. It always names an acting
 * administrator and a reason, and the grant is audited atomically.
 */
class EconomyGrant extends Command
{
    protected $signature = 'economy:grant {admin : Username of the acting administrator} {player} {amount} {--currency=CRN} {--reason=} {--key= : Idempotency key (defaults to a fresh one)}';

    protected $description = 'Grant currency to a player (audited)';

    public function handle(LedgerService $ledger): int
    {
        $admin = User::query()->where('username', $this->argument('admin'))->first();
        $player = User::query()->where('username', $this->argument('player'))->first();
        $reason = (string) $this->option('reason');
        if (! $admin || ! $player) {
            $this->error('Unknown administrator or player.');

            return self::FAILURE;
        }
        if (trim($reason) === '') {
            $this->error('--reason is required.');

            return self::FAILURE;
        }
        if (! ctype_digit((string) $this->argument('amount'))) {
            $this->error('Amount must be a positive whole number.');

            return self::FAILURE;
        }

        $transaction = $ledger->mint(
            $player,
            strtoupper((string) $this->option('currency')),
            (int) $this->argument('amount'),
            $reason,
            'admin:'.($this->option('key') ?: (string) Str::ulid()),
            $admin,
            'admin',
        );
        $this->info("Granted. Transaction {$transaction->public_id}.");

        return self::SUCCESS;
    }
}
