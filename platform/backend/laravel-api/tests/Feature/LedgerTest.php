<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\LedgerEntry;
use App\Models\LedgerTransaction;
use App\Models\User;
use App\Services\Economy\EconomyException;
use App\Services\Economy\LedgerService;
use App\Services\Economy\Leg;
use App\Services\Economy\Posting;
use Illuminate\Foundation\Testing\RefreshDatabase;
use LogicException;
use Tests\TestCase;

class LedgerTest extends TestCase
{
    use RefreshDatabase;

    private LedgerService $ledger;

    private User $admin;

    private User $alice;

    private User $bob;

    protected function setUp(): void
    {
        parent::setUp();
        $this->ledger = app(LedgerService::class);
        $this->admin = User::factory()->create(['username' => 'admin']);
        $this->alice = User::factory()->create(['username' => 'alice']);
        $this->bob = User::factory()->create(['username' => 'bob']);
        $this->ledger->mint($this->alice, 'CRN', 1000, 'test funding', 'seed-alice', $this->admin);
    }

    public function test_mint_is_double_entry_and_audited(): void
    {
        $this->assertSame(1000, $this->ledger->balance($this->alice, 'CRN'));
        $this->assertSame(-1000, $this->ledger->systemAccount('mint', 'CRN')->balance);

        $audit = AuditLog::where('action', 'economy.mint')->sole();
        $this->assertSame($this->admin->id, $audit->actor_id);
        $this->assertSame('test funding', $audit->reason);
        $this->assertSame([], $this->ledger->verify());
    }

    public function test_transfer_moves_value_and_records_balance_state(): void
    {
        $transaction = $this->ledger->transfer($this->alice, $this->bob, 'CRN', 250, 'pay-1');

        $this->assertSame(750, $this->ledger->balance($this->alice, 'CRN'));
        $this->assertSame(250, $this->ledger->balance($this->bob, 'CRN'));

        $entries = $transaction->entries()->orderBy('amount')->get();
        $this->assertSame([-250, 250], $entries->pluck('amount')->all());
        $this->assertSame([750, 250], $entries->pluck('balance_after')->all());
        $this->assertSame(0, $entries->sum('amount'));
        $this->assertSame([], $this->ledger->verify());
    }

    public function test_insufficient_funds_writes_nothing(): void
    {
        $before = [LedgerTransaction::count(), LedgerEntry::count()];

        try {
            $this->ledger->transfer($this->alice, $this->bob, 'CRN', 1001, 'too-much');
            $this->fail('expected insufficient funds');
        } catch (EconomyException $e) {
            $this->assertSame('insufficient_funds', $e->errorCode);
        }

        $this->assertSame($before, [LedgerTransaction::count(), LedgerEntry::count()]);
        $this->assertSame(1000, $this->ledger->balance($this->alice, 'CRN'));
        $this->assertSame([], $this->ledger->verify());
    }

    public function test_duplicate_request_never_pays_twice(): void
    {
        $first = $this->ledger->transfer($this->alice, $this->bob, 'CRN', 100, 'same-key');
        $second = $this->ledger->transfer($this->alice, $this->bob, 'CRN', 100, 'same-key');

        $this->assertTrue($first->is($second));
        $this->assertTrue($second->wasReplayed);
        $this->assertSame(900, $this->ledger->balance($this->alice, 'CRN'));
        $this->assertSame(100, $this->ledger->balance($this->bob, 'CRN'));
    }

    public function test_reusing_a_key_for_a_different_request_is_refused(): void
    {
        $this->ledger->transfer($this->alice, $this->bob, 'CRN', 100, 'key-x');

        $this->expectExceptionObject(EconomyException::idempotencyConflict());
        $this->ledger->transfer($this->alice, $this->bob, 'CRN', 999, 'key-x');
    }

    public function test_the_same_key_from_two_players_is_two_requests(): void
    {
        $this->ledger->mint($this->bob, 'CRN', 50, 'test funding', 'seed-bob', $this->admin);
        $this->ledger->transfer($this->alice, $this->bob, 'CRN', 10, 'shared');
        $this->ledger->transfer($this->bob, $this->alice, 'CRN', 10, 'shared');

        $this->assertSame(1000, $this->ledger->balance($this->alice, 'CRN'));
    }

    public function test_unbalanced_mixed_or_degenerate_postings_are_rejected(): void
    {
        $a = $this->ledger->walletFor($this->alice, 'CRN')->account;
        $b = $this->ledger->walletFor($this->bob, 'CRN')->account;
        $creative = $this->ledger->walletFor($this->bob, 'CRT')->account;

        $cases = [
            'unbalanced' => [new Leg($a, -10), new Leg($b, 9)],
            'mixed realms' => [new Leg($a, -10), new Leg($creative, 10)],
            'single leg' => [new Leg($a, -10)],
            'zero leg' => [new Leg($a, 0), new Leg($b, 0)],
            'same account twice' => [new Leg($a, -10), new Leg($a, 10)],
        ];
        foreach ($cases as $name => $legs) {
            try {
                $this->ledger->post(new Posting('test', 'test', "case-{$name}", $legs));
                $this->fail("{$name} was accepted");
            } catch (EconomyException $e) {
                $this->assertSame('invalid_posting', $e->errorCode, $name);
            }
        }
        $this->assertSame([], $this->ledger->verify());
    }

    public function test_non_transferable_currencies_and_self_transfers_are_refused(): void
    {
        foreach ([[$this->bob, 'CRT'], [$this->bob, 'GEM'], [$this->alice, 'CRN']] as [$to, $currency]) {
            try {
                $this->ledger->transfer($this->alice, $to, $currency, 1, "nt-{$currency}-{$to->id}");
                $this->fail("{$currency} transfer accepted");
            } catch (EconomyException $e) {
                $this->assertSame('invalid_posting', $e->errorCode);
            }
        }
    }

    public function test_entries_and_transactions_are_append_only(): void
    {
        $entry = LedgerEntry::firstOrFail();

        $this->expectException(LogicException::class);
        $entry->update(['amount' => 1]);
    }

    public function test_ledger_entries_cannot_be_deleted(): void
    {
        $this->expectException(LogicException::class);
        LedgerTransaction::firstOrFail()->delete();
    }

    public function test_burn_removes_money_into_the_sink(): void
    {
        $this->ledger->burn($this->alice, 'CRN', 40, 'repair', 'repair-1');

        $this->assertSame(960, $this->ledger->balance($this->alice, 'CRN'));
        $this->assertSame(40, $this->ledger->systemAccount('burn', 'CRN')->balance);
        $this->assertSame([], $this->ledger->verify());
    }

    public function test_verify_detects_a_tampered_cached_balance(): void
    {
        $account = $this->ledger->walletFor($this->alice, 'CRN')->account;
        // Simulate a direct "UPDATE balance" that bypassed the ledger.
        \DB::table('ledger_accounts')->where('id', $account->id)->update(['balance' => 5000]);

        $problems = $this->ledger->verify();
        $this->assertNotEmpty($problems);
        $this->assertStringContainsString('caches balance 5000', implode("\n", $problems));
        $this->artisan('ledger:verify')->assertFailed();
    }

    public function test_transfer_api_requires_idempotency_and_is_idempotent(): void
    {
        $this->actingAs($this->alice)
            ->postJson('/api/v1/transfers', ['to' => 'bob', 'currency' => 'CRN', 'amount' => 5])
            ->assertStatus(400)
            ->assertJsonPath('error.code', 'idempotency_key_required');

        $send = fn () => $this->actingAs($this->alice)
            ->withHeader('Idempotency-Key', 'order-0001')
            ->postJson('/api/v1/transfers', ['to' => 'bob', 'currency' => 'crn', 'amount' => 5]);

        $send()->assertCreated()->assertJsonPath('replayed', false)->assertJsonPath('balance', 995);
        $send()->assertOk()->assertJsonPath('replayed', true)->assertJsonPath('balance', 995);
        $this->assertSame(5, $this->ledger->balance($this->bob, 'CRN'));
    }

    public function test_transfer_api_rejects_floats_and_overdrafts(): void
    {
        $this->actingAs($this->alice)->withHeader('Idempotency-Key', 'float-0001')
            ->postJson('/api/v1/transfers', ['to' => 'bob', 'currency' => 'CRN', 'amount' => 1.5])
            ->assertUnprocessable();

        $this->actingAs($this->alice)->withHeader('Idempotency-Key', 'over-00001')
            ->postJson('/api/v1/transfers', ['to' => 'bob', 'currency' => 'CRN', 'amount' => 5000])
            ->assertUnprocessable()
            ->assertJsonPath('error.code', 'insufficient_funds');
    }

    public function test_history_lists_entries_newest_first(): void
    {
        $this->ledger->transfer($this->alice, $this->bob, 'CRN', 30, 'h-1');

        $this->actingAs($this->alice)->getJson('/api/v1/wallets/CRN/entries')
            ->assertOk()
            ->assertJsonPath('entries.0.amount', -30)
            ->assertJsonPath('entries.0.balance_after', 970)
            ->assertJsonPath('entries.1.amount', 1000);
    }

    public function test_admin_grant_command_requires_a_reason(): void
    {
        $this->artisan('economy:grant', ['admin' => 'admin', 'player' => 'bob', 'amount' => '10'])
            ->assertFailed();
        $this->artisan('economy:grant', ['admin' => 'admin', 'player' => 'bob', 'amount' => '10', '--reason' => 'event prize'])
            ->assertSuccessful();

        $this->assertSame(10, $this->ledger->balance($this->bob, 'CRN'));
        $this->assertSame(2, AuditLog::where('action', 'economy.mint')->count());
    }
}
