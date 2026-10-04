<?php

namespace Tests\Feature;

use App\Models\Contract;
use App\Models\ItemDelivery;
use App\Models\User;
use App\Services\Economy\LedgerService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ContractTest extends TestCase
{
    use RefreshDatabase;

    private const TOKEN = 'test-game-service-token-0123456789abcdef';

    private LedgerService $ledger;

    private User $poster;

    private User $worker;

    private User $other;

    protected function setUp(): void
    {
        parent::setUp();
        config(['platform.internal.service_token' => self::TOKEN]);
        $this->ledger = app(LedgerService::class);
        $admin = User::factory()->create(['username' => 'admin']);
        $this->poster = User::factory()->create(['username' => 'poster']);
        $this->worker = User::factory()->create(['username' => 'worker']);
        $this->other = User::factory()->create(['username' => 'other']);
        $this->ledger->mint($this->poster, 'CRN', 500, 'test funding', 'seed-poster', $admin);
    }

    private function postContract(array $over = [], string $key = 'post-key-0001')
    {
        Sanctum::actingAs($this->poster);

        return $this->withHeader('Idempotency-Key', $key)->postJson('/api/v1/contracts', array_merge([
            'world' => 'main', 'title' => 'Wood for the hall', 'item' => 'oak_log', 'count' => 16, 'reward' => 120, 'hours' => 2,
        ], $over));
    }

    private function fulfil(string $id, User $who, array $over = [])
    {
        return $this->withHeader('Authorization', 'Bearer '.self::TOKEN)->postJson("/api/internal/v1/contracts/{$id}/fulfil", array_merge([
            'key' => 'outbox-fulfil-01', 'contractor' => $who->public_id, 'item' => 'oak_log', 'count' => 16,
        ], $over));
    }

    private function crn(User $u): int
    {
        return $this->ledger->balance($u, 'CRN');
    }

    public function test_the_reward_is_locked_then_released_to_the_contractor_with_the_goods_to_the_poster(): void
    {
        $id = $this->postContract()->assertCreated()->assertJsonPath('balance', 380)->json('contract.id');
        $this->postContract()->assertOk()->assertJsonPath('replayed', true);
        $this->assertSame(380, $this->crn($this->poster));
        $escrow = $this->ledger->escrowAccount("contract:{$id}", 'CRN');
        $this->assertSame(120, $escrow->balance);

        $this->postJson("/api/v1/contracts/{$id}/accept")->assertStatus(422)->assertJsonPath('error.code', 'own_listing');
        Sanctum::actingAs($this->worker);
        $this->fulfil($id, $this->worker)->assertStatus(409)->assertJsonPath('error.code', 'contract_closed');
        $this->postJson("/api/v1/contracts/{$id}/accept")->assertOk()->assertJsonPath('contract.status', 'accepted')->assertJsonPath('contract.role', 'contractor');
        Sanctum::actingAs($this->other);
        $this->postJson("/api/v1/contracts/{$id}/accept")->assertStatus(409);

        $this->fulfil($id, $this->other)->assertStatus(403)->assertJsonPath('error.code', 'not_contractor');
        $this->fulfil($id, $this->worker, ['count' => 15])->assertStatus(422)->assertJsonPath('error.code', 'wrong_goods');
        $this->fulfil($id, $this->worker)->assertCreated();
        $this->fulfil($id, $this->worker)->assertOk()->assertJsonPath('replayed', true);

        $this->assertSame(120, $this->crn($this->worker));
        $this->assertSame(0, $escrow->fresh()->balance);
        $delivery = ItemDelivery::sole();
        $this->assertSame([$this->poster->id, 'oak_log', 16, 'contract'], [$delivery->user_id, $delivery->item, $delivery->count, $delivery->reason]);
        $this->assertSame([], $this->ledger->verify());
    }

    public function test_cancel_abandon_and_expiry_refund_the_poster(): void
    {
        $a = $this->postContract([], 'post-key-0002')->json('contract.id');
        $b = $this->postContract(['reward' => 100], 'post-key-0003')->json('contract.id');
        $this->postContract(['reward' => 1000], 'post-key-0004')->assertStatus(422)->assertJsonPath('error.code', 'insufficient_funds');
        $this->assertSame(280, $this->crn($this->poster));

        $this->deleteJson("/api/v1/contracts/{$a}")->assertOk();
        $this->assertSame(400, $this->crn($this->poster));

        Sanctum::actingAs($this->worker);
        $this->postJson("/api/v1/contracts/{$b}/accept")->assertOk();
        Sanctum::actingAs($this->poster);
        $this->deleteJson("/api/v1/contracts/{$b}")->assertStatus(409)->assertJsonPath('error.code', 'contract_taken');
        Sanctum::actingAs($this->worker);
        $this->postJson("/api/v1/contracts/{$b}/abandon")->assertOk()->assertJsonPath('contract.status', 'open');

        $this->travel(3)->hours();
        $this->artisan('contracts:expire')->assertSuccessful();
        $this->assertSame('expired', Contract::where('public_id', $b)->value('status'));
        $this->assertSame(500, $this->crn($this->poster));
        $this->getJson('/api/v1/contracts?world=main')->assertOk()->assertJsonCount(0, 'contracts');
        $this->assertSame([], $this->ledger->verify());
    }
}
