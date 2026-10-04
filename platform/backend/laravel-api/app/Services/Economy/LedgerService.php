<?php

namespace App\Services\Economy;

use App\Models\Currency;
use App\Models\LedgerAccount;
use App\Models\LedgerEntry;
use App\Models\LedgerTransaction;
use App\Models\User;
use App\Models\Wallet;
use App\Services\Audit\AuditLogger;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * The only code allowed to move value (docs/ECONOMY_LEDGER.md).
 *
 * Every movement is a balanced, double-entry transaction:
 *  - atomic: one database transaction, accounts locked in id order;
 *  - idempotent: the same idempotency key returns the original transaction,
 *    a reused key with different content is refused;
 *  - auditable: entries are append-only and record the balance after them.
 */
class LedgerService
{
    public function __construct(private readonly AuditLogger $audit) {}

    public function currency(string $code): Currency
    {
        return Currency::query()->findOr($code, fn () => throw EconomyException::invalid("Unknown currency {$code}."));
    }

    /** The user's wallet in a currency, created on first use. */
    public function walletFor(User $user, string $currency): Wallet
    {
        $this->currency($currency);

        $existing = Wallet::query()->where('user_id', $user->id)->where('currency', $currency)->first();
        if ($existing) {
            return $existing;
        }

        try {
            return DB::transaction(function () use ($user, $currency) {
                $account = LedgerAccount::create([
                    'code' => "wallet:{$user->public_id}:{$currency}",
                    'type' => LedgerAccount::TYPE_WALLET,
                    'currency' => $currency,
                    'owner_user_id' => $user->id,
                ]);

                return Wallet::create([
                    'user_id' => $user->id,
                    'currency' => $currency,
                    'ledger_account_id' => $account->id,
                ]);
            });
        } catch (QueryException $e) {
            // A concurrent request created it first.
            return Wallet::query()->where('user_id', $user->id)->where('currency', $currency)->firstOrFail();
        }
    }

    /**
     * A platform-owned account. `mint` is the source of all money (it may be
     * negative: minus its balance is the money ever created); `burn` is the
     * sink money leaves the economy through; `fees` collects platform fees.
     */
    public function systemAccount(string $name, string $currency): LedgerAccount
    {
        $this->currency($currency);

        return LedgerAccount::query()->firstOrCreate(
            ['code' => "system:{$name}:{$currency}"],
            [
                'type' => LedgerAccount::TYPE_SYSTEM,
                'currency' => $currency,
                'allow_negative' => $name === 'mint',
            ],
        );
    }

    /** The escrow account holding funds locked for one thing (`$ref`, e.g. `listing:<id>`). */
    public function escrowAccount(string $ref, string $currency): LedgerAccount
    {
        $this->currency($currency);

        return LedgerAccount::query()->firstOrCreate(
            ['code' => "escrow:{$ref}:{$currency}"],
            ['type' => LedgerAccount::TYPE_ESCROW, 'currency' => $currency, 'allow_negative' => false],
        );
    }

    public function balance(User $user, string $currency): int
    {
        return $this->walletFor($user, $currency)->account()->value('balance');
    }

    /** Record one balanced transaction. */
    public function post(Posting $posting): LedgerTransaction
    {
        $this->assertBalanced($posting);
        $hash = $posting->hash();

        if ($existing = $this->replay($posting->idempotencyKey, $hash)) {
            return $existing;
        }

        try {
            return DB::transaction(function () use ($posting, $hash) {
                // Lock every touched account in id order: two concurrent
                // postings over the same accounts can never deadlock.
                $ids = array_map(fn (Leg $leg) => $leg->account->id, $posting->legs);
                sort($ids);
                $accounts = LedgerAccount::query()->whereIn('id', $ids)->orderBy('id')->lockForUpdate()->get()->keyBy('id');

                $transaction = LedgerTransaction::create([
                    'public_id' => (string) Str::ulid(),
                    'type' => $posting->type,
                    'reason' => $posting->reason,
                    'reference_type' => $posting->referenceType,
                    'reference_id' => $posting->referenceId,
                    'idempotency_key' => $posting->idempotencyKey,
                    'request_hash' => $hash,
                    'initiated_by' => $posting->initiatedBy,
                    'metadata' => $posting->metadata ?: null,
                ]);

                foreach ($posting->legs as $leg) {
                    /** @var LedgerAccount $account */
                    $account = $accounts[$leg->account->id];
                    $after = $account->balance + $leg->amount;
                    if ($after < 0 && ! $account->allow_negative) {
                        throw EconomyException::insufficientFunds();
                    }

                    LedgerEntry::create([
                        'transaction_id' => $transaction->id,
                        'account_id' => $account->id,
                        'currency' => $account->currency,
                        'amount' => $leg->amount,
                        'balance_after' => $after,
                    ]);

                    $account->balance = $after;
                    $account->entry_count += 1;
                    $account->save();
                }

                return $transaction;
            });
        } catch (QueryException $e) {
            // Lost a race on the idempotency key: the winner's row is the answer.
            if ($existing = $this->replay($posting->idempotencyKey, $hash)) {
                return $existing;
            }
            throw $e;
        }
    }

    /** Player-to-player transfer of a transferable currency. */
    public function transfer(User $from, User $to, string $currency, int $amount, string $idempotencyKey, ?string $memo = null): LedgerTransaction
    {
        if ($amount <= 0) {
            throw EconomyException::invalid('Transfer amount must be a positive whole number of minor units.');
        }
        if ($from->is($to)) {
            throw EconomyException::invalid('A transfer needs two different players.');
        }
        if (! $this->currency($currency)->is_transferable) {
            throw EconomyException::invalid("{$currency} cannot be transferred between players.");
        }

        $source = $this->walletFor($from, $currency)->account;
        $target = $this->walletFor($to, $currency)->account;

        return $this->post(new Posting(
            type: 'transfer',
            reason: 'Player transfer',
            idempotencyKey: "transfer:{$from->public_id}:{$idempotencyKey}",
            legs: [new Leg($source, -$amount), new Leg($target, $amount)],
            initiatedBy: $from->id,
            metadata: array_filter(['memo' => $memo, 'to' => $to->public_id]),
        ));
    }

    /**
     * Create money into a wallet. Only gameplay rewards (by the game server)
     * and audited administrative grants do this; there is no unaudited path.
     */
    public function mint(User $recipient, string $currency, int $amount, string $reason, string $idempotencyKey, ?User $actor, string $actorType = 'user'): LedgerTransaction
    {
        if ($amount <= 0) {
            throw EconomyException::invalid('Minted amount must be positive.');
        }
        if (trim($reason) === '') {
            throw EconomyException::invalid('Minting requires a reason.');
        }

        return DB::transaction(function () use ($recipient, $currency, $amount, $reason, $idempotencyKey, $actor, $actorType) {
            $transaction = $this->post(new Posting(
                type: 'mint',
                reason: $reason,
                idempotencyKey: "mint:{$idempotencyKey}",
                legs: [
                    new Leg($this->systemAccount('mint', $currency), -$amount),
                    new Leg($this->walletFor($recipient, $currency)->account, $amount),
                ],
                initiatedBy: $actor?->id,
            ));

            if (! $transaction->wasRecentlyCreated) {
                return $transaction;
            }

            $this->audit->record(
                action: 'economy.mint',
                actor: $actor,
                subjectType: 'ledger_transaction',
                subjectId: $transaction->public_id,
                reason: $reason,
                payload: ['recipient' => $recipient->public_id, 'currency' => $currency, 'amount' => $amount],
                actorType: $actorType,
            );

            return $transaction;
        });
    }

    /** Remove money from a wallet into the burn sink (repairs, fees, services). */
    public function burn(User $payer, string $currency, int $amount, string $reason, string $idempotencyKey): LedgerTransaction
    {
        if ($amount <= 0) {
            throw EconomyException::invalid('Burned amount must be positive.');
        }

        return $this->post(new Posting(
            type: 'burn',
            reason: $reason,
            idempotencyKey: "burn:{$payer->public_id}:{$idempotencyKey}",
            legs: [
                new Leg($this->walletFor($payer, $currency)->account, -$amount),
                new Leg($this->systemAccount('burn', $currency), $amount),
            ],
            initiatedBy: $payer->id,
        ));
    }

    /**
     * Check the ledger's invariants. Returns every violation found; an empty
     * list means the books balance.
     *
     * @return list<string>
     */
    public function verify(): array
    {
        $problems = [];

        $unbalanced = LedgerEntry::query()
            ->select('transaction_id', 'currency', DB::raw('SUM(amount) as total'))
            ->groupBy('transaction_id', 'currency')
            ->havingRaw('SUM(amount) <> 0')
            ->get();
        foreach ($unbalanced as $row) {
            $problems[] = "transaction {$row->transaction_id} does not balance in {$row->currency} (off by {$row->total})";
        }

        $sums = LedgerEntry::query()
            ->select('account_id', DB::raw('SUM(amount) as total'), DB::raw('COUNT(*) as entries'))
            ->groupBy('account_id')
            ->get()
            ->keyBy('account_id');
        foreach (LedgerAccount::query()->orderBy('id')->cursor() as $account) {
            $sum = (int) ($sums[$account->id]->total ?? 0);
            $count = (int) ($sums[$account->id]->entries ?? 0);
            if ($sum !== $account->balance || $count !== $account->entry_count) {
                $problems[] = "account {$account->code} caches balance {$account->balance}/{$account->entry_count} entries but entries sum to {$sum}/{$count}";
            }
            if ($account->balance < 0 && ! $account->allow_negative) {
                $problems[] = "account {$account->code} is negative ({$account->balance})";
            }
        }

        $totals = LedgerAccount::query()
            ->select('currency', DB::raw('SUM(balance) as total'))
            ->groupBy('currency')
            ->get();
        foreach ($totals as $row) {
            if ((int) $row->total !== 0) {
                $problems[] = "currency {$row->currency} balances sum to {$row->total}, not 0";
            }
        }

        return $problems;
    }

    private function assertBalanced(Posting $posting): void
    {
        if (count($posting->legs) < 2) {
            throw EconomyException::invalid('A transaction needs at least two legs.');
        }
        if (trim($posting->idempotencyKey) === '' || strlen($posting->idempotencyKey) > 120) {
            throw EconomyException::invalid('An idempotency key of 1-120 characters is required.');
        }

        $currencies = [];
        $accounts = [];
        $sum = 0;
        foreach ($posting->legs as $leg) {
            if ($leg->amount === 0) {
                throw EconomyException::invalid('Zero-amount legs are not allowed.');
            }
            if (isset($accounts[$leg->account->id])) {
                throw EconomyException::invalid('An account may appear only once per transaction.');
            }
            $accounts[$leg->account->id] = true;
            $currencies[$leg->account->currency] = true;
            $sum += $leg->amount;
        }
        if (count($currencies) !== 1) {
            throw EconomyException::invalid('All legs of a transaction must share one currency.');
        }
        if ($sum !== 0) {
            throw EconomyException::invalid('Transaction legs must sum to zero.');
        }
    }

    private function replay(string $key, string $hash): ?LedgerTransaction
    {
        $existing = LedgerTransaction::query()->where('idempotency_key', $key)->first();
        if (! $existing) {
            return null;
        }
        if (! hash_equals($existing->request_hash, $hash)) {
            throw EconomyException::idempotencyConflict();
        }
        $existing->wasReplayed = true;

        return $existing;
    }
}
