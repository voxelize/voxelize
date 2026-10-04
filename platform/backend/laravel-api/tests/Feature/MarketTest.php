<?php

namespace Tests\Feature;

use App\Models\ItemDelivery;
use App\Models\MarketListing;
use App\Models\User;
use App\Services\Economy\LedgerService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class MarketTest extends TestCase
{
    use RefreshDatabase;

    private const TOKEN = 'test-game-service-token-0123456789abcdef';

    private LedgerService $ledger;

    private User $seller;

    private User $alice;

    private User $bob;

    protected function setUp(): void
    {
        parent::setUp();
        config(['platform.market.fee_bps' => 500, 'platform.internal.service_token' => self::TOKEN]);
        $this->ledger = app(LedgerService::class);
        $admin = User::factory()->create(['username' => 'admin']);
        $this->seller = User::factory()->create(['username' => 'seller']);
        $this->alice = User::factory()->create(['username' => 'alice']);
        $this->bob = User::factory()->create(['username' => 'bob']);
        $this->ledger->mint($this->alice, 'CRN', 1000, 'test funding', 'seed-alice', $admin);
        $this->ledger->mint($this->bob, 'CRN', 1000, 'test funding', 'seed-bob', $admin);
    }

    private function internal()
    {
        return $this->withHeader('Authorization', 'Bearer '.self::TOKEN);
    }

    /** @param  array<string, mixed>  $overrides */
    private function list(array $overrides = []): string
    {
        $response = $this->internal()->postJson('/api/internal/v1/market/listings', array_merge([
            'key' => 'outbox-'.Str::random(12),
            'seller' => $this->seller->public_id,
            'world' => 'main',
            'kind' => 'fixed',
            'item' => 'iron_ingot',
            'count' => 8,
            'price' => 200,
        ], $overrides));
        $response->assertSuccessful();

        return $response->json('listing.id');
    }

    private function crn(User $user): int
    {
        return $this->ledger->balance($user, 'CRN');
    }

    public function test_listing_needs_the_service_token_and_is_idempotent_by_outbox_key(): void
    {
        $body = ['key' => 'outbox-00000001', 'seller' => $this->seller->public_id, 'world' => 'main', 'kind' => 'fixed', 'item' => 'coal', 'count' => 3, 'price' => 9];
        $this->postJson('/api/internal/v1/market/listings', $body)->assertStatus(401);
        $first = $this->internal()->postJson('/api/internal/v1/market/listings', $body)->assertCreated()->json('listing.id');
        $again = $this->internal()->postJson('/api/internal/v1/market/listings', $body)->assertOk();
        $this->assertSame($first, $again->json('listing.id'));
        $this->assertSame(1, MarketListing::count());

        $this->internal()->postJson('/api/internal/v1/market/listings', array_merge($body, ['key' => 'outbox-00000002', 'price' => 0]))
            ->assertStatus(422)->assertJsonPath('error.code', 'bad_price');
        $this->internal()->postJson('/api/internal/v1/market/listings', array_merge($body, ['key' => 'outbox-00000003', 'buyout' => 50]))
            ->assertStatus(422)->assertJsonPath('error.code', 'bad_price');
    }

    public function test_buying_pays_the_seller_and_the_fee_in_one_transaction_and_delivers(): void
    {
        $id = $this->list();
        Sanctum::actingAs($this->alice);
        $this->postJson("/api/v1/market/listings/{$id}/buy")->assertCreated()->assertJsonPath('balance', 800);

        $this->assertSame(190, $this->crn($this->seller));
        $this->assertSame(10, $this->ledger->systemAccount('fees', 'CRN')->balance);
        $delivery = ItemDelivery::sole();
        $this->assertSame([$this->alice->id, 'iron_ingot', 8, 'purchase', 'pending'], [$delivery->user_id, $delivery->item, $delivery->count, $delivery->reason, $delivery->status]);

        // A retry by the buyer is answered; another buyer is too late.
        $this->postJson("/api/v1/market/listings/{$id}/buy")->assertOk()->assertJsonPath('replayed', true);
        Sanctum::actingAs($this->bob);
        $this->postJson("/api/v1/market/listings/{$id}/buy")->assertStatus(409)->assertJsonPath('error.code', 'listing_closed');
        $this->assertSame(1000, $this->crn($this->bob));
        $this->assertSame(1, ItemDelivery::count());
        $this->assertSame([], $this->ledger->verify());
    }

    public function test_refusals_change_nothing(): void
    {
        $id = $this->list(['price' => 5000]);
        Sanctum::actingAs($this->alice);
        $this->postJson("/api/v1/market/listings/{$id}/buy")->assertStatus(422)->assertJsonPath('error.code', 'insufficient_funds');
        Sanctum::actingAs($this->seller);
        $this->postJson("/api/v1/market/listings/{$id}/buy")->assertStatus(422)->assertJsonPath('error.code', 'own_listing');
        $this->assertSame('open', MarketListing::sole()->status);
        $this->assertSame(0, ItemDelivery::count());
        $this->assertSame(1000, $this->crn($this->alice));
    }

    public function test_auctions_hold_bids_in_escrow_refund_the_outbid_and_settle(): void
    {
        $id = $this->list(['kind' => 'auction', 'price' => 100, 'buyout' => 900, 'hours' => 1]);
        Sanctum::actingAs($this->alice);
        $bid = fn (int $amount, string $key) => $this->withHeader('Idempotency-Key', $key)->postJson("/api/v1/market/listings/{$id}/bids", ['amount' => $amount]);

        $bid(99, 'alice-bid-0001')->assertStatus(422)->assertJsonPath('error.code', 'bid_too_low');
        $bid(100, 'alice-bid-0002')->assertCreated();
        $bid(100, 'alice-bid-0002')->assertOk()->assertJsonPath('replayed', true);
        $this->assertSame(900, $this->crn($this->alice));
        $bid(200, 'alice-bid-0003')->assertStatus(422)->assertJsonPath('error.code', 'already_highest');

        Sanctum::actingAs($this->bob);
        $bid(104, 'bob-bid-00001')->assertStatus(422)->assertJsonPath('error.code', 'bid_too_low');
        $bid(105, 'bob-bid-00002')->assertCreated()->assertJsonPath('listing.current_bid', 105);
        $bid(950, 'bob-bid-00003')->assertStatus(422);
        $this->assertSame(1000, $this->crn($this->alice), 'outbid: refunded');
        $this->assertSame(895, $this->crn($this->bob));
        $listing = MarketListing::sole();
        $this->assertSame(105, $this->ledger->escrowAccount("listing:{$listing->public_id}", 'CRN')->balance);

        Sanctum::actingAs($this->seller);
        $this->deleteJson("/api/v1/market/listings/{$id}")->assertStatus(409)->assertJsonPath('error.code', 'has_bids');

        $this->travel(2)->hours();
        $this->artisan('market:settle')->assertSuccessful();
        $listing->refresh();
        $this->assertSame(['sold', $this->bob->id], [$listing->status, $listing->buyer_id]);
        $this->assertSame(100, $this->crn($this->seller), '105 minus a 5 fee');
        $this->assertSame(0, $this->ledger->escrowAccount("listing:{$listing->public_id}", 'CRN')->balance);
        $this->assertSame('auction_won', ItemDelivery::sole()->reason);
        $this->assertSame([], $this->ledger->verify());
    }

    public function test_buyout_refunds_the_standing_bid(): void
    {
        $id = $this->list(['kind' => 'auction', 'price' => 100, 'buyout' => 300]);
        Sanctum::actingAs($this->alice);
        $this->withHeader('Idempotency-Key', 'alice-bid-0010')->postJson("/api/v1/market/listings/{$id}/bids", ['amount' => 150])->assertCreated();
        Sanctum::actingAs($this->bob);
        $this->postJson("/api/v1/market/listings/{$id}/buy")->assertCreated();
        $this->assertSame(1000, $this->crn($this->alice));
        $this->assertSame(700, $this->crn($this->bob));
        $this->assertSame(285, $this->crn($this->seller));
        $this->assertSame([], $this->ledger->verify());
    }

    public function test_stall_payments_are_one_sale_per_key(): void
    {
        $pay = fn (array $over = []) => $this->internal()->postJson('/api/internal/v1/payments', array_merge([
            'key' => 'stall-sale-0001',
            'from' => $this->alice->public_id,
            'to' => $this->seller->public_id,
            'amount' => 100,
            'reason' => 'Stall: 4 bread',
        ], $over));
        $pay()->assertCreated();
        $pay()->assertOk()->assertJsonPath('replayed', true);
        $this->assertSame(900, $this->crn($this->alice));
        $this->assertSame(95, $this->crn($this->seller));
        $this->assertSame(5, $this->ledger->systemAccount('fees', 'CRN')->balance);

        $pay(['key' => 'stall-sale-0002', 'amount' => 5000])->assertStatus(422)->assertJsonPath('error.code', 'insufficient_funds');
        $pay(['key' => 'stall-sale-0003', 'to' => $this->alice->public_id])->assertStatus(422)->assertJsonPath('error.code', 'own_listing');
        $pay(['key' => 'stall-sale-0004', 'to' => 'nobody'])->assertStatus(404);
        $this->flushHeaders()->postJson('/api/internal/v1/payments', [])->assertStatus(401);

        // Trades between players pay no fee.
        $this->internal()->postJson('/api/internal/v1/payments', [
            'key' => 'trade-0000001', 'kind' => 'trade', 'from' => $this->bob->public_id,
            'to' => $this->alice->public_id, 'amount' => 40, 'reason' => 'Trade',
        ])->assertCreated();
        $this->assertSame(940, $this->crn($this->alice));
        $this->assertSame(5, $this->ledger->systemAccount('fees', 'CRN')->balance);
        $this->assertSame([], $this->ledger->verify());
    }

    public function test_cancelled_and_expired_goods_go_back_to_the_seller_and_deliveries_are_acknowledged_once(): void
    {
        $cancelled = $this->list();
        $expiring = $this->list(['hours' => 1, 'item' => 'coal']);
        Sanctum::actingAs($this->alice);
        $this->deleteJson("/api/v1/market/listings/{$cancelled}")->assertStatus(403);
        Sanctum::actingAs($this->seller);
        $this->deleteJson("/api/v1/market/listings/{$cancelled}")->assertOk();
        $this->travel(2)->hours();
        $this->artisan('market:settle')->assertSuccessful();
        $this->assertSame(['cancelled', 'expired'], ItemDelivery::orderBy('id')->pluck('reason')->all());
        $this->getJson('/api/v1/deliveries')->assertOk()->assertJsonCount(2, 'deliveries');

        $pending = $this->internal()->postJson('/api/internal/v1/deliveries/pending', ['world' => 'main', 'players' => [$this->seller->public_id, $this->alice->public_id]]);
        $pending->assertOk()->assertJsonCount(2, 'deliveries')->assertJsonPath('deliveries.0.player', $this->seller->public_id);
        $first = $pending->json('deliveries.0.id');
        $this->internal()->postJson("/api/internal/v1/deliveries/{$first}/ack")->assertOk();
        $this->internal()->postJson("/api/internal/v1/deliveries/{$first}/ack")->assertOk();
        $this->internal()->postJson('/api/internal/v1/deliveries/pending', ['world' => 'main', 'players' => [$this->seller->public_id]])
            ->assertJsonCount(1, 'deliveries');
        $this->internal()->postJson('/api/internal/v1/deliveries/nope/ack')->assertStatus(404);
        $this->internal()->postJson('/api/internal/v1/deliveries/pending', ['world' => 'main', 'players' => []])
            ->assertOk()->assertJsonCount(0, 'deliveries');
    }
}
