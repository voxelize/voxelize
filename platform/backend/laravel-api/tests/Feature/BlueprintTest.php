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
}
