<?php

namespace Tests\Feature;

use App\Models\Land;
use App\Models\LandHistory;
use App\Models\User;
use App\Services\Economy\LedgerService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use LogicException;
use Tests\TestCase;

class LandTest extends TestCase
{
    use RefreshDatabase;

    private const TOKEN = 'test-game-service-token-0123456789abcdef';

    private LedgerService $ledger;

    private User $alice;

    private User $bob;

    protected function setUp(): void
    {
        parent::setUp();
        config(['platform.land.price_per_chunk' => 10, 'platform.internal.service_token' => self::TOKEN]);
        $this->ledger = app(LedgerService::class);
        $admin = User::factory()->create(['username' => 'admin']);
        $this->alice = User::factory()->create(['username' => 'alice']);
        $this->bob = User::factory()->create(['username' => 'bob']);
        $this->ledger->mint($this->alice, 'CRN', 1000, 'test funding', 'seed-alice', $admin);
    }

    /** @param  array<string, mixed>  $overrides */
    private function claim(User $as, array $overrides = [], string $key = 'claim-key-0001')
    {
        Sanctum::actingAs($as);

        return $this->withHeader('Idempotency-Key', $key)->postJson('/api/v1/lands', array_merge([
            'world' => 'main',
            'dimension' => 'overworld',
            'min' => [0, 0],
            'max' => [1, 2],
            'name' => 'Homestead',
        ], $overrides));
    }

    public function test_claiming_charges_the_wallet_into_the_burn_sink(): void
    {
        $response = $this->claim($this->alice)->assertCreated();
        $response->assertJsonPath('land.chunks', 6)->assertJsonPath('land.owner.name', 'alice');

        $this->assertSame(940, $this->ledger->balance($this->alice, 'CRN'));
        $this->assertSame(60, $this->ledger->systemAccount('burn', 'CRN')->balance);
        $this->assertSame([], $this->ledger->verify());
        $history = LandHistory::sole();
        $this->assertSame('claimed', $history->event);
        $this->assertNotNull($history->ledger_transaction_id);
    }

    public function test_a_retried_claim_is_answered_once_and_paid_once(): void
    {
        $first = $this->claim($this->alice)->assertCreated()->json('land.id');
        $again = $this->claim($this->alice)->assertOk();
        $this->assertSame($first, $again->json('land.id'));
        $this->assertTrue($again->json('replayed'));
        $this->assertSame(940, $this->ledger->balance($this->alice, 'CRN'));
        $this->assertSame(1, Land::count());
    }

    public function test_overlaps_limits_and_funds_are_enforced(): void
    {
        $this->claim($this->alice)->assertCreated();
        $this->ledger->mint($this->bob, 'CRN', 1000, 'test funding', 'seed-bob', $this->alice);
        $this->claim($this->bob, ['min' => [1, 2], 'max' => [3, 3]], 'bob-claim-01')
            ->assertStatus(409)->assertJsonPath('error.code', 'land_taken');
        // The same box in the underworld is free.
        $this->claim($this->bob, ['dimension' => 'underworld'], 'bob-claim-02')->assertCreated();

        $this->claim($this->alice, ['min' => [10, 10], 'max' => [19, 10]], 'too-wide-01')
            ->assertStatus(422)->assertJsonPath('error.code', 'claim_too_large');

        config(['platform.land.max_chunks_per_player' => 8]);
        $this->claim($this->alice, ['min' => [10, 10], 'max' => [12, 10]], 'over-limit-1')
            ->assertStatus(422)->assertJsonPath('error.code', 'land_limit');

        config(['platform.land.max_chunks_per_player' => 64, 'platform.land.price_per_chunk' => 1000]);
        $this->claim($this->alice, ['min' => [20, 20], 'max' => [20, 20]], 'too-dear-01')
            ->assertStatus(422)->assertJsonPath('error.code', 'insufficient_funds');
        $this->assertSame(1, Land::where('owner_id', $this->alice->id)->count(), 'nothing half-written');

        $this->claim($this->alice, [], 'short')->assertStatus(400);
        $this->claim($this->alice, ['dimension' => 'moon'], 'bad-dim-0001')->assertStatus(404);
    }

    public function test_members_roles_and_release(): void
    {
        $id = $this->claim($this->alice)->json('land.id');
        $carol = User::factory()->create(['username' => 'carol']);

        Sanctum::actingAs($this->alice);
        $this->postJson("/api/v1/lands/{$id}/members", ['player' => 'bob', 'role' => 'manager'])
            ->assertOk()->assertJsonPath('land.members.0.role', 'manager');

        // A manager adds builders but not managers.
        Sanctum::actingAs($this->bob);
        $this->postJson("/api/v1/lands/{$id}/members", ['player' => 'carol', 'role' => 'builder'])->assertOk();
        $this->postJson("/api/v1/lands/{$id}/members", ['player' => 'carol', 'role' => 'manager'])
            ->assertStatus(403)->assertJsonPath('error.code', 'forbidden');
        $this->deleteJson("/api/v1/lands/{$id}")->assertStatus(403);

        // Strangers change nothing.
        Sanctum::actingAs($carol);
        $this->patchJson("/api/v1/lands/{$id}", ['name' => 'Mine now'])->assertStatus(403);

        Sanctum::actingAs($this->alice);
        $this->patchJson("/api/v1/lands/{$id}", ['permissions' => ['use' => true, 'fly' => true]])
            ->assertOk()->assertJsonPath('land.permissions', ['build' => false, 'containers' => false, 'use' => true]);
        $this->deleteJson("/api/v1/lands/{$id}/members/carol")->assertOk();
        $this->deleteJson("/api/v1/lands/{$id}")->assertOk();
        $this->deleteJson("/api/v1/lands/{$id}")->assertStatus(409);

        // Released land is free again.
        $this->ledger->mint($this->bob, 'CRN', 100, 'test funding', 'seed-bob-2', $this->alice);
        $this->claim($this->bob, [], 'bob-claim-03')->assertCreated();

        $events = LandHistory::orderBy('id')->pluck('event')->all();
        $this->assertSame(['claimed', 'member_added', 'member_added', 'updated', 'member_removed', 'released', 'claimed'], $events);
        $this->expectException(LogicException::class);
        LandHistory::first()->delete();
    }

    public function test_the_internal_feed_needs_the_service_token_and_supports_etags(): void
    {
        $this->claim($this->alice)->assertCreated();
        $this->getJson('/api/internal/v1/lands?world=main')->assertStatus(401);
        $this->withHeader('Authorization', 'Bearer wrong')->getJson('/api/internal/v1/lands?world=main')->assertStatus(401);

        $feed = $this->withHeader('Authorization', 'Bearer '.self::TOKEN)->get('/api/internal/v1/lands?world=main');
        $feed->assertOk();
        $land = $feed->json('lands.0');
        $this->assertSame([0, 0], $land['min']);
        $this->assertSame([1, 2], $land['max']);
        $this->assertSame('overworld', $land['dimension']);
        $this->assertSame($this->alice->public_id, $land['owner']['id']);
        $this->assertSame(['build' => false, 'containers' => false, 'use' => false], $land['public']);

        $etag = $feed->headers->get('ETag');
        $this->withHeaders(['Authorization' => 'Bearer '.self::TOKEN, 'If-None-Match' => $etag])
            ->get('/api/internal/v1/lands?world=main')->assertStatus(304);

        config(['platform.internal.service_token' => '']);
        $this->withHeader('Authorization', 'Bearer ')->getJson('/api/internal/v1/lands?world=main')->assertStatus(401);
    }
}
