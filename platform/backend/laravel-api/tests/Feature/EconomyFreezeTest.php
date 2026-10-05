<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\User;
use App\Services\Economy\LedgerService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class EconomyFreezeTest extends TestCase
{
    use RefreshDatabase;

    private const TOKEN = 'test-game-service-token-0123456789abcdef';

    public function test_an_unbalanced_ledger_freezes_money_until_an_admin_releases_it(): void
    {
        config(['platform.internal.service_token' => self::TOKEN]);
        $ledger = app(LedgerService::class);
        $admin = User::factory()->create(['username' => 'boss', 'roles' => ['admin']]);
        $alice = User::factory()->create(['username' => 'alice']);
        User::factory()->create(['username' => 'bob']);
        $ledger->mint($alice, 'CRN', 1000, 'test funding', 'seed-alice', $admin);
        $transfer = fn (string $key) => $this->withHeader('Idempotency-Key', $key)
            ->postJson('/api/v1/transfers', ['to' => 'bob', 'currency' => 'CRN', 'amount' => 5]);

        // Healthy books: verifying changes nothing.
        $this->artisan('ledger:verify')->assertSuccessful();
        Sanctum::actingAs($alice);
        $transfer('key-before-0001')->assertCreated();

        // A balance changed behind the ledger's back.
        $account = $ledger->walletFor($alice, 'CRN')->account;
        DB::table('ledger_accounts')->where('id', $account->id)->update(['balance' => 5000]);
        $this->artisan('ledger:verify')->assertFailed();
        $this->assertTrue(AuditLog::query()->where('action', 'economy.frozen')->exists());

        $transfer('key-frozen-0001')->assertStatus(503)->assertJsonPath('error.code', 'economy_frozen');
        $this->postJson('/api/v1/market/listings/x/buy')->assertStatus(503);
        $this->getJson('/api/v1/wallets')->assertOk(); // reading still works
        $this->flushHeaders()->withHeader('Authorization', 'Bearer '.self::TOKEN)
            ->postJson('/api/internal/v1/payments', [])->assertStatus(503);

        Sanctum::actingAs($admin);
        $this->getJson('/api/v1/admin/economy')->assertOk()->assertJsonPath('frozen.problems.0', fn ($p) => str_contains($p, 'caches balance 5000'));
        $this->postJson('/api/v1/admin/economy/release', ['reason' => 'looked at it'])
            ->assertStatus(409)->assertJsonPath('error.code', 'still_inconsistent');

        // Fixed by the operator: the cached balance matches its entries again.
        DB::table('ledger_accounts')->where('id', $account->id)->update(['balance' => 995]);
        $this->postJson('/api/v1/admin/economy/release', ['reason' => 'restored the balance'])->assertOk()->assertJsonPath('frozen', null);
        $this->postJson('/api/v1/admin/economy/release', ['reason' => 'again'])->assertStatus(409)->assertJsonPath('error.code', 'not_frozen');
        $this->assertTrue(AuditLog::query()->where('action', 'economy.released')->where('reason', 'restored the balance')->exists());

        Sanctum::actingAs($alice);
        $transfer('key-after-00001')->assertCreated();
        $this->postJson('/api/v1/admin/economy/release', ['reason' => 'mine'])->assertForbidden();
    }

    public function test_verifying_without_freezing_only_reports(): void
    {
        $ledger = app(LedgerService::class);
        $admin = User::factory()->create(['roles' => ['admin']]);
        $alice = User::factory()->create();
        $ledger->mint($alice, 'CRN', 10, 'test funding', 'seed', $admin);
        DB::table('ledger_accounts')->where('id', $ledger->walletFor($alice, 'CRN')->account->id)->update(['balance' => 7]);
        $this->artisan('ledger:verify --no-freeze')->assertFailed();
        $this->assertFalse(AuditLog::query()->where('action', 'economy.frozen')->exists());
    }
}
