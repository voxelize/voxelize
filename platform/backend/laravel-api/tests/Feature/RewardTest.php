<?php

namespace Tests\Feature;

use App\Models\GameplayReward;
use App\Models\User;
use App\Services\Economy\LedgerService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RewardTest extends TestCase
{
    use RefreshDatabase;

    private const TOKEN = 'test-game-service-token-0123456789abcdef';

    protected function setUp(): void
    {
        parent::setUp();
        config(['platform.internal.service_token' => self::TOKEN, 'platform.rewards.daily_cap' => 100]);
    }

    private function reward(User $user, int $amount, string $key)
    {
        return $this->withHeader('Authorization', 'Bearer '.self::TOKEN)->postJson('/api/internal/v1/rewards', [
            'key' => $key, 'player' => $user->public_id, 'world' => 'main', 'source' => 'job', 'reason' => 'Miner', 'amount' => $amount,
        ]);
    }

    public function test_rewards_are_minted_once_per_key_and_capped_per_day(): void
    {
        $ledger = app(LedgerService::class);
        $miner = User::factory()->create();
        $this->postJson('/api/internal/v1/rewards', [])->assertStatus(401);
        $this->reward($miner, 60, 'reward-00001')->assertOk()->assertJsonPath('paid', 60);
        $this->reward($miner, 60, 'reward-00001')->assertOk()->assertJsonPath('paid', 60);
        $this->assertSame(60, $ledger->balance($miner, 'CRN'), 'a retry pays once');
        $this->reward($miner, 60, 'reward-00002')->assertOk()->assertJsonPath('paid', 40)->assertJsonPath('paid_today', 100);
        $this->reward($miner, 5, 'reward-00003')->assertOk()->assertJsonPath('paid', 0);
        $this->assertSame(100, $ledger->balance($miner, 'CRN'));
        $this->assertSame(3, GameplayReward::count());

        $this->travel(1)->days();
        $this->reward($miner, 5, 'reward-00004')->assertOk()->assertJsonPath('paid', 5);
        $this->assertSame([], $ledger->verify());
        $this->reward($miner, 5, 'reward-00005')->assertOk();
        $this->withHeader('Authorization', 'Bearer '.self::TOKEN)->postJson('/api/internal/v1/rewards', [
            'key' => 'reward-00006', 'player' => 'nobody', 'world' => 'main', 'source' => 'quest', 'reason' => 'x', 'amount' => 5,
        ])->assertNotFound();
    }
}
