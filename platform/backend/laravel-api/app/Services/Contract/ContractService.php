<?php

namespace App\Services\Contract;

use App\Models\Contract;
use App\Models\ItemDelivery;
use App\Models\User;
use App\Services\Audit\AuditLogger;
use App\Services\Economy\LedgerService;
use App\Services\Economy\Leg;
use App\Services\Economy\Posting;
use App\Services\Market\MarketException;
use Carbon\CarbonInterface;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Delivery contracts with the reward locked in `escrow:contract:<id>` from
 * posting to fulfilment, expiry or cancellation. Every money movement is a
 * ledger transaction with an idempotency key derived from the contract.
 */
class ContractService
{
    public const MAX_HOURS = 168;

    public function __construct(
        private readonly LedgerService $ledger,
        private readonly AuditLogger $audit,
    ) {}

    public function post(User $poster, string $world, string $title, string $item, int $count, int $reward, int $hours, string $key): Contract
    {
        if ($existing = Contract::query()->where('poster_id', $poster->id)->where('post_key', $key)->first()) {
            $existing->wasReplayed = true;

            return $existing;
        }
        if (! array_key_exists($world, (array) config('platform.game.worlds'))) {
            throw new MarketException('unknown_world', 'No such world.', 404);
        }
        if (! preg_match('/^[a-z0-9_]{1,64}$/', $item) || $count < 1 || $count > 9999) {
            throw new MarketException('bad_goods', 'Name an item and a count of 1-9999.');
        }
        if ($reward < 1 || $reward > (int) config('platform.market.max_price')) {
            throw new MarketException('bad_price', 'Rewards are whole amounts from 1.');
        }
        if ($hours < 1 || $hours > self::MAX_HOURS) {
            throw new MarketException('bad_duration', 'Contracts run 1 to 168 hours.');
        }
        $currency = (string) config('platform.market.currency');

        try {
            return DB::transaction(function () use ($poster, $world, $title, $item, $count, $reward, $hours, $key, $currency) {
                $contract = Contract::query()->create([
                    'public_id' => (string) Str::ulid(),
                    'poster_id' => $poster->id,
                    'world' => $world,
                    'title' => mb_substr(trim($title) ?: "{$count} {$item}", 0, 80),
                    'item' => $item,
                    'count' => $count,
                    'currency' => $currency,
                    'reward' => $reward,
                    'status' => 'open',
                    'deadline_at' => now()->addHours($hours),
                    'post_key' => $key,
                ]);
                $this->ledger->post(new Posting(
                    type: 'escrow_lock',
                    reason: "Contract reward: {$contract->title}",
                    idempotencyKey: "contract:lock:{$contract->public_id}",
                    legs: [
                        new Leg($this->ledger->walletFor($poster, $currency)->account, -$reward),
                        new Leg($this->escrow($contract), $reward),
                    ],
                    referenceType: 'contract',
                    referenceId: $contract->public_id,
                    initiatedBy: $poster->id,
                ));
                $this->audit->record(
                    action: 'contract.post',
                    actor: $poster,
                    subjectType: 'contract',
                    subjectId: $contract->public_id,
                    payload: ['item' => $item, 'count' => $count, 'reward' => $reward],
                );

                return $contract;
            });
        } catch (QueryException $e) {
            if ($existing = Contract::query()->where('poster_id', $poster->id)->where('post_key', $key)->first()) {
                $existing->wasReplayed = true;

                return $existing;
            }
            throw $e;
        }
    }

    public function accept(User $contractor, Contract $contract): Contract
    {
        return DB::transaction(function () use ($contractor, $contract) {
            $contract = Contract::query()->lockForUpdate()->findOrFail($contract->id);
            if ($contract->status === 'accepted' && $contract->contractor_id === $contractor->id) {
                return $contract;
            }
            $this->assertLive($contract, 'open');
            if ($contract->poster_id === $contractor->id) {
                throw new MarketException('own_listing', 'You cannot take your own contract.');
            }
            $contract->status = 'accepted';
            $contract->contractor_id = $contractor->id;
            $contract->accepted_at = now();
            $contract->version += 1;
            $contract->save();

            return $contract;
        });
    }

    /** The contractor gives the job back; it is open again. */
    public function abandon(User $contractor, Contract $contract): Contract
    {
        return DB::transaction(function () use ($contractor, $contract) {
            $contract = Contract::query()->lockForUpdate()->findOrFail($contract->id);
            if ($contract->status !== 'accepted' || $contract->contractor_id !== $contractor->id) {
                throw new MarketException('forbidden', 'You are not working on that contract.', 403);
            }
            $contract->status = 'open';
            $contract->contractor_id = null;
            $contract->accepted_at = null;
            $contract->version += 1;
            $contract->save();

            return $contract;
        });
    }

    /** The poster withdraws an untaken contract; the reward comes back. */
    public function cancel(User $poster, Contract $contract): Contract
    {
        return DB::transaction(function () use ($poster, $contract) {
            $contract = Contract::query()->lockForUpdate()->findOrFail($contract->id);
            if ($contract->poster_id !== $poster->id) {
                throw new MarketException('forbidden', 'That is not your contract.', 403);
            }
            if ($contract->status !== 'open') {
                throw new MarketException('contract_taken', 'Only an untaken contract can be withdrawn.', 409);
            }
            $this->refund($contract, 'cancelled');

            return $contract;
        });
    }

    /**
     * The contractor's goods arrived through a game server (`$key` is its
     * outbox id): release the reward, deliver the goods to the poster.
     */
    public function fulfil(User $contractor, Contract $contract, string $item, int $count, ?int $durability, string $key): Contract
    {
        return DB::transaction(function () use ($contractor, $contract, $item, $count, $durability, $key) {
            $contract = Contract::query()->lockForUpdate()->findOrFail($contract->id);
            if ($contract->status === 'fulfilled' && $contract->fulfil_key === $key) {
                $contract->wasReplayed = true;

                return $contract;
            }
            $this->assertLive($contract, 'accepted');
            if ($contract->contractor_id !== $contractor->id) {
                throw new MarketException('not_contractor', 'Accept the contract before delivering.', 403);
            }
            if ($item !== $contract->item || $count !== $contract->count) {
                throw new MarketException('wrong_goods', "This contract wants exactly {$contract->count} {$contract->item}.");
            }
            $this->ledger->post(new Posting(
                type: 'escrow_release',
                reason: "Contract fulfilled: {$contract->title}",
                idempotencyKey: "contract:release:{$contract->public_id}",
                legs: [
                    new Leg($this->escrow($contract), -$contract->reward),
                    new Leg($this->ledger->walletFor($contractor, $contract->currency)->account, $contract->reward),
                ],
                referenceType: 'contract',
                referenceId: $contract->public_id,
                initiatedBy: $contractor->id,
            ));
            ItemDelivery::query()->create([
                'public_id' => (string) Str::ulid(),
                'user_id' => $contract->poster_id,
                'world' => $contract->world,
                'item' => $item,
                'count' => $count,
                'durability' => $durability,
                'reason' => 'contract',
                'status' => 'pending',
            ]);
            $contract->status = 'fulfilled';
            $contract->fulfil_key = $key;
            $contract->version += 1;
            $contract->save();
            $this->audit->record(
                action: 'contract.fulfil',
                actor: $contractor,
                subjectType: 'contract',
                subjectId: $contract->public_id,
                payload: ['reward' => $contract->reward],
                actorType: 'game_server',
            );

            return $contract;
        });
    }

    /** Refund every contract past its deadline. Returns how many. */
    public function expire(?CarbonInterface $now = null): int
    {
        $now ??= now();
        $count = 0;
        $due = Contract::query()->whereIn('status', ['open', 'accepted'])->where('deadline_at', '<=', $now)->pluck('id');
        foreach ($due as $id) {
            $count += DB::transaction(function () use ($id, $now) {
                $contract = Contract::query()->lockForUpdate()->find($id);
                if (! $contract || ! in_array($contract->status, ['open', 'accepted'], true) || $contract->deadline_at->greaterThan($now)) {
                    return 0;
                }
                $this->refund($contract, 'expired');

                return 1;
            });
        }

        return $count;
    }

    private function refund(Contract $contract, string $status): void
    {
        $this->ledger->post(new Posting(
            type: 'escrow_refund',
            reason: "Contract {$status}: {$contract->title}",
            idempotencyKey: "contract:refund:{$contract->public_id}",
            legs: [
                new Leg($this->escrow($contract), -$contract->reward),
                new Leg($this->ledger->walletFor($contract->poster, $contract->currency)->account, $contract->reward),
            ],
            referenceType: 'contract',
            referenceId: $contract->public_id,
        ));
        $contract->status = $status;
        $contract->version += 1;
        $contract->save();
    }

    private function assertLive(Contract $contract, string $status): void
    {
        if ($contract->status !== $status || $contract->deadline_at->isPast()) {
            throw new MarketException('contract_closed', 'That contract is not available.', 409);
        }
    }

    private function escrow(Contract $contract)
    {
        return $this->ledger->escrowAccount("contract:{$contract->public_id}", $contract->currency);
    }
}
