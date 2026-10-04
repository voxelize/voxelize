<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\BlueprintDesign;
use App\Models\User;
use App\Services\Economy\LedgerService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class BlueprintTest extends TestCase
{
    use RefreshDatabase;

    private const TOKEN = 'test-game-service-token-0123456789abcdef';

    private LedgerService $ledger;

    private User $maker;

    private User $alice;

    private User $bob;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        config(['platform.market.fee_bps' => 500, 'platform.internal.service_token' => self::TOKEN, 'platform.blueprints.disk' => 'local']);
        $this->ledger = app(LedgerService::class);
        $admin = User::factory()->create(['username' => 'admin']);
        $this->maker = User::factory()->create(['username' => 'maker']);
        $this->alice = User::factory()->create(['username' => 'alice']);
        $this->bob = User::factory()->create(['username' => 'bob']);
        $this->ledger->mint($this->alice, 'CRN', 1000, 'test funding', 'seed-alice', $admin);
        $this->ledger->mint($this->bob, 'CRN', 1000, 'test funding', 'seed-bob', $admin);
    }

    /** @return array<string, mixed> */
    private function capture(array $over = []): array
    {
        // A 2x2x1 box: three planks and an air cell.
        return array_merge([
            'key' => 'capture-0000001',
            'creator' => $this->maker->public_id,
            'world' => 'main',
            'name' => 'Tiny Hut',
            'size' => [2, 1, 2],
            'palette' => [['block' => null, 'raw' => 0], ['block' => 'planks', 'raw' => 12]],
            'runs' => [[1, 3], [0, 1]],
            'materials' => ['planks' => 3],
        ], $over);
    }

    private function internal()
    {
        return $this->withHeader('Authorization', 'Bearer '.self::TOKEN);
    }

    public function test_capture_is_stored_hashed_and_idempotent(): void
    {
        $id = $this->internal()->postJson('/api/internal/v1/blueprints', $this->capture())->assertCreated()->json('blueprint.id');
        $this->internal()->postJson('/api/internal/v1/blueprints', $this->capture())->assertOk()->assertJsonPath('blueprint.id', $id);
        $design = BlueprintDesign::sole();
        $this->assertSame([3, 'draft'], [$design->block_count, $design->status]);
        Storage::disk('local')->assertExists($design->storage_path);
        $this->assertSame(1, AuditLog::where('action', 'blueprint.capture')->count());

        $bad = fn (array $over, string $key) => $this->internal()->postJson('/api/internal/v1/blueprints', $this->capture(array_merge(['key' => $key], $over)));
        $bad(['runs' => [[1, 2]]], 'capture-0000002')->assertStatus(422)->assertJsonPath('error.code', 'bad_blueprint');
        $bad(['size' => [40, 1, 1], 'runs' => [[1, 40]]], 'capture-0000003')->assertStatus(422);
        $bad(['runs' => [[0, 4]]], 'capture-0000004')->assertStatus(422);
        $bad(['runs' => [[9, 4]]], 'capture-0000005')->assertStatus(422);
        $this->flushHeaders()->postJson('/api/internal/v1/blueprints', $this->capture())->assertStatus(401);
    }

    public function test_licences_pay_the_creator_and_limited_editions_sell_out(): void
    {
        $id = $this->internal()->postJson('/api/internal/v1/blueprints', $this->capture())->json('blueprint.id');
        Sanctum::actingAs($this->alice);
        $this->postJson("/api/v1/blueprints/{$id}/buy")->assertStatus(409)->assertJsonPath('error.code', 'not_for_sale');
        $this->patchJson("/api/v1/blueprints/{$id}", ['price' => 5])->assertStatus(403);

        Sanctum::actingAs($this->maker);
        $this->patchJson("/api/v1/blueprints/{$id}", ['published' => true])->assertStatus(422)->assertJsonPath('error.code', 'bad_price');
        $this->patchJson("/api/v1/blueprints/{$id}", ['price' => 200, 'max_copies' => 1, 'published' => true])
            ->assertOk()->assertJsonPath('blueprint.status', 'published');
        $this->postJson("/api/v1/blueprints/{$id}/buy")->assertStatus(422)->assertJsonPath('error.code', 'own_listing');

        Sanctum::actingAs($this->alice);
        $this->getJson('/api/v1/blueprints?world=main')->assertOk()->assertJsonPath('blueprints.0.licensed', false);
        $this->postJson("/api/v1/blueprints/{$id}/buy")->assertCreated()->assertJsonPath('edition', 1)->assertJsonPath('balance', 800);
        $this->postJson("/api/v1/blueprints/{$id}/buy")->assertOk();
        $this->assertSame(800, $this->ledger->balance($this->alice, 'CRN'), 'bought once');
        $this->assertSame(190, $this->ledger->balance($this->maker, 'CRN'));
        $this->assertSame(10, $this->ledger->systemAccount('fees', 'CRN')->balance);
        $this->getJson('/api/v1/blueprints/mine')->assertOk()->assertJsonPath('blueprints.0.licensed', true);

        Sanctum::actingAs($this->bob);
        $this->postJson("/api/v1/blueprints/{$id}/buy")->assertStatus(409)->assertJsonPath('error.code', 'sold_out');
        $this->assertSame([], $this->ledger->verify());
    }

    public function test_only_licensed_players_get_the_layout_and_moderation_removes_it(): void
    {
        $id = $this->internal()->postJson('/api/internal/v1/blueprints', $this->capture())->json('blueprint.id');
        $get = fn (User $u) => $this->internal()->getJson("/api/internal/v1/blueprints/{$id}?player={$u->public_id}");
        $get($this->maker)->assertOk()->assertJsonPath('layout.size', [2, 1, 2])->assertJsonPath('materials.planks', 3);
        $get($this->alice)->assertStatus(403)->assertJsonPath('error.code', 'not_licensed');

        $this->artisan('blueprints:reject', ['admin' => 'admin', 'blueprint' => $id, '--reason' => 'copied'])->assertSuccessful();
        $get($this->maker)->assertStatus(403);
        $this->assertSame('rejected', BlueprintDesign::sole()->status);

        // A damaged file is never handed out.
        $design = BlueprintDesign::sole();
        $design->status = 'draft';
        $design->save();
        Storage::disk('local')->put($design->storage_path, '{"tampered":true}');
        $get($this->maker)->assertStatus(503)->assertJsonPath('error.code', 'storage_unavailable');
    }

    public function test_licences_resell_with_a_royalty_to_the_creator_and_keep_provenance(): void
    {
        $id = $this->internal()->postJson('/api/internal/v1/blueprints', $this->capture())->json('blueprint.id');
        Sanctum::actingAs($this->maker);
        $this->patchJson("/api/v1/blueprints/{$id}", ['price' => 100, 'max_copies' => 1, 'published' => true, 'royalty_bps' => 2000])
            ->assertOk()->assertJsonPath('blueprint.royalty_bps', 2000);
        $this->postJson("/api/v1/blueprints/{$id}/resales", ['price' => 10])->assertStatus(403)->assertJsonPath('error.code', 'not_licensed');

        Sanctum::actingAs($this->alice);
        $this->postJson("/api/v1/blueprints/{$id}/buy")->assertCreated();
        $resale = $this->postJson("/api/v1/blueprints/{$id}/resales", ['price' => 300])->assertCreated()->json('resale.id');
        $this->postJson("/api/v1/blueprints/{$id}/resales", ['price' => 200])->assertStatus(409)->assertJsonPath('error.code', 'already_listed');
        $this->postJson("/api/v1/blueprint-resales/{$resale}/buy")->assertStatus(422)->assertJsonPath('error.code', 'own_listing');

        // The edition is sold out, but the licence can change hands.
        Sanctum::actingAs($this->bob);
        $this->postJson("/api/v1/blueprints/{$id}/buy")->assertStatus(409)->assertJsonPath('error.code', 'sold_out');
        $this->getJson("/api/v1/blueprints/{$id}/resales")->assertOk()->assertJsonPath('resales.0.price', 300);
        $this->postJson("/api/v1/blueprint-resales/{$resale}/buy")->assertOk()->assertJsonPath('balance', 700);

        // 300: fee 15, royalty 60 to the maker, 225 to Alice.
        $this->assertSame(1125, $this->ledger->balance($this->alice, 'CRN'), '1000 - 100 + 225');
        $this->assertSame(95 + 60, $this->ledger->balance($this->maker, 'CRN'));
        $this->assertSame(5 + 15, $this->ledger->systemAccount('fees', 'CRN')->balance);
        $this->assertSame([], $this->ledger->verify());

        $get = fn (User $u) => $this->internal()->getJson("/api/internal/v1/blueprints/{$id}?player={$u->public_id}");
        $get($this->bob)->assertOk();
        $get($this->alice)->assertStatus(403);
        $this->postJson("/api/v1/blueprint-resales/{$resale}/buy")->assertOk();
        $this->assertSame(700, $this->ledger->balance($this->bob, 'CRN'), 'bought once');

        $this->getJson("/api/v1/blueprints/{$id}/provenance")->assertOk()
            ->assertJsonPath('provenance.0.event', 'minted')
            ->assertJsonPath('provenance.1.event', 'resold')
            ->assertJsonPath('provenance.1.from', 'alice')
            ->assertJsonPath('provenance.1.to', 'bob')
            ->assertJsonPath('provenance.1.royalty', 60)
            ->assertJsonPath('provenance.1.edition', 1);

        // Alice may now buy it back on resale like anyone else.
        Sanctum::actingAs($this->bob);
        $again = $this->postJson("/api/v1/blueprints/{$id}/resales", ['price' => 50])->assertCreated()->json('resale.id');
        $this->deleteJson("/api/v1/blueprint-resales/{$again}")->assertOk();
        Sanctum::actingAs($this->alice);
        $this->postJson("/api/v1/blueprint-resales/{$again}/buy")->assertStatus(409);
    }
}
