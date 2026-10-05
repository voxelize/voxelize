<?php

namespace App\Services\Economy;

use App\Models\User;
use App\Services\Audit\AuditLogger;
use App\Services\Market\MarketException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/**
 * When the books do not balance, money stops moving: `ledger:verify` freezes
 * every endpoint that moves money (docs/ECONOMY_LEDGER.md §5) until an
 * administrator, with the ledger consistent again, releases it.
 */
class EconomyFreeze
{
    private const KEY = 'economy.frozen';

    public function __construct(private readonly AuditLogger $audit) {}

    /** `{ "since", "problems" }` while frozen, else null. */
    public function state(): ?array
    {
        $state = Cache::get(self::KEY);

        return is_array($state) ? $state : null;
    }

    /** @param  list<string>  $problems */
    public function freeze(array $problems): void
    {
        if ($this->state() !== null) {
            return;
        }
        Cache::forever(self::KEY, ['since' => now()->toIso8601String(), 'problems' => array_slice($problems, 0, 50)]);
        Log::critical('Economy frozen: the ledger does not balance', ['problems' => $problems]);
        $this->audit->record('economy.frozen', null, 'economy', 'ledger', 'ledger:verify found problems', ['problems' => array_slice($problems, 0, 20)]);
    }

    /** Release the freeze; refused while the ledger still does not balance. */
    public function release(User $admin, LedgerService $ledger, string $reason): void
    {
        if ($this->state() === null) {
            throw new MarketException('not_frozen', 'The economy is not frozen.', 409);
        }
        $problems = $ledger->verify();
        if ($problems !== []) {
            throw new MarketException('still_inconsistent', 'The ledger still does not balance: '.$problems[0], 409);
        }
        Cache::forget(self::KEY);
        $this->audit->record('economy.released', $admin, 'economy', 'ledger', $reason);
    }
}
