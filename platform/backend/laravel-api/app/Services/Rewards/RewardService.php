<?php

namespace App\Services\Rewards;

use App\Models\GameplayReward;
use App\Models\User;
use App\Services\Audit\AuditLogger;
use App\Services\Economy\LedgerService;
use Illuminate\Support\Facades\DB;

/**
 * Gameplay rewards: Crowns a game server earns a player through jobs and
 * quests. They are minted (new money), so each player has a daily cap; a
 * reward over the cap is paid only up to it.
 */
class RewardService
{
    public function __construct(
        private readonly LedgerService $ledger,
        private readonly AuditLogger $audit,
    ) {}

    public function dailyCap(): int
    {
        return (int) config('platform.rewards.daily_cap');
    }

    /** Paid to a player since the start of today (UTC). */
    public function paidToday(User $user): int
    {
        return (int) GameplayReward::query()->where('user_id', $user->id)
            ->where('created_at', '>=', now()->startOfDay())->sum('paid');
    }

    public function pay(User $user, string $world, string $source, string $reason, int $amount, string $key): GameplayReward
    {
        return DB::transaction(function () use ($user, $world, $source, $reason, $amount, $key) {
            // One payout at a time per player, so the cap holds under races.
            User::query()->whereKey($user->id)->lockForUpdate()->first();
            if ($existing = GameplayReward::query()->where('reward_key', $key)->first()) {
                return $existing;
            }
            $paid = max(0, min($amount, $this->dailyCap() - $this->paidToday($user)));
            $transaction = $paid > 0
                ? $this->ledger->mint($user, (string) config('platform.rewards.currency'), $paid, "Gameplay reward ({$source}): {$reason}", "reward:{$key}", null, 'game_server')
                : null;
            $reward = GameplayReward::query()->create([
                'user_id' => $user->id,
                'world' => $world,
                'source' => $source,
                'reason' => mb_substr($reason, 0, 120),
                'requested' => $amount,
                'paid' => $paid,
                'ledger_transaction_id' => $transaction?->id,
                'reward_key' => $key,
                'created_at' => now(),
            ]);
            $this->audit->record(
                action: 'reward.pay',
                actor: $user,
                subjectType: 'user',
                subjectId: $user->public_id,
                payload: ['source' => $source, 'reason' => $reason, 'requested' => $amount, 'paid' => $paid],
                actorType: 'game_server',
            );

            return $reward;
        });
    }
}
