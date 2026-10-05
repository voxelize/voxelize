<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\User;
use App\Services\Economy\LedgerService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AdminTest extends TestCase
{
    use RefreshDatabase;

    private const TOKEN = 'test-game-service-token-0123456789abcdef';

    protected function setUp(): void
    {
        parent::setUp();
        config(['platform.internal.service_token' => self::TOKEN, 'platform.game.ticket_secrets' => [str_repeat('k', 40)]]);
    }

    private function as(User $user): static
    {
        Sanctum::actingAs($user);

        return $this;
    }

    private function feed()
    {
        return $this->withHeader('Authorization', 'Bearer '.self::TOKEN)->getJson('/api/internal/v1/sanctions');
    }

    public function test_only_staff_reach_the_panel_and_moderators_only_part_of_it(): void
    {
        $player = User::factory()->create(['username' => 'plain']);
        $mod = User::factory()->create(['username' => 'mod', 'roles' => ['moderator']]);
        $admin = User::factory()->create(['username' => 'boss', 'roles' => ['admin']]);

        $this->as($player)->getJson('/api/v1/admin/players')->assertForbidden()->assertJsonPath('error.code', 'forbidden');
        $this->as($mod)->getJson('/api/v1/admin/players?q=PLA')->assertOk()->assertJsonCount(1, 'players')->assertJsonPath('players.0.username', 'plain');
        $this->as($mod)->getJson('/api/v1/admin/economy')->assertForbidden();
        $this->as($mod)->postJson('/api/v1/admin/players/plain/grant', ['currency' => 'CRN', 'amount' => 5, 'reason' => 'gift'])->assertForbidden();
        $this->as($mod)->putJson('/api/v1/admin/players/boss/mute', ['minutes' => 5, 'reason' => 'nope'])->assertForbidden();
        $this->as($mod)->putJson('/api/v1/admin/players/plain/status', ['status' => 'banned', 'reason' => 'spam'])->assertForbidden();

        $this->as($admin)->postJson('/api/v1/admin/players/plain/grant', ['currency' => 'CRN', 'amount' => 50, 'reason' => 'event prize'])
            ->assertCreated()->assertJsonPath('balance', 50);
        $this->as($admin)->getJson('/api/v1/admin/economy')->assertOk()
            ->assertJsonPath('problems', [])->assertJsonFragment(['currency' => 'CRN', 'wallets' => 50, 'minted' => 50]);
        $this->as($admin)->putJson('/api/v1/admin/players/mod/roles', ['roles' => [], 'reason' => 'stepped down'])->assertOk()->assertJsonPath('player.roles', ['player']);
        $this->as($mod->fresh())->getJson('/api/v1/admin/players')->assertForbidden();
        $this->as($admin)->putJson('/api/v1/admin/players/boss/roles', ['roles' => [], 'reason' => 'oops'])->assertStatus(422);
        $this->as($admin)->getJson('/api/v1/admin/players/plain')->assertOk()->assertJsonPath('player.wallets.0.balance', 50)
            ->assertJsonPath('audit.0.action', 'economy.mint');
        $this->assertSame(['economy.mint', 'admin.roles'], AuditLog::query()->orderBy('id')->pluck('action')->all(), 'the refused changes left no trace');
    }

    public function test_sanctions_lock_players_out_and_reach_game_servers(): void
    {
        $ledger = app(LedgerService::class);
        $player = User::factory()->create(['username' => 'rowdy']);
        $admin = User::factory()->create(['username' => 'boss', 'roles' => ['admin']]);
        $mod = User::factory()->create(['username' => 'mod', 'roles' => ['moderator']]);
        $this->feed()->assertOk()->assertJsonPath('players', []);

        $this->as($mod)->putJson('/api/v1/admin/players/rowdy/mute', ['minutes' => 30, 'reason' => 'caps lock'])->assertOk()
            ->assertJsonPath('player.mute_reason', 'caps lock');
        $this->feed()->assertJsonPath('players.0.id', $player->public_id)->assertJsonPath('players.0.status', 'active')
            ->assertJsonPath('players.0.mute_reason', 'caps lock');
        $this->as($admin)->getJson('/api/v1/admin/players?status=muted')->assertJsonCount(1, 'players');

        $this->as($mod)->putJson('/api/v1/admin/players/rowdy/status', ['status' => 'suspended', 'reason' => 'griefing'])->assertOk();
        $this->feed()->assertJsonPath('players.0.status', 'suspended')->assertJsonPath('players.0.reason', 'griefing');
        $this->as($player->fresh())->postJson('/api/v1/game/tickets', ['world' => 'main'])->assertForbidden()->assertJsonPath('error.code', 'account_suspended');
        $this->postJson('/api/v1/auth/login', ['login' => 'rowdy', 'password' => 'password'])->assertForbidden();

        $this->travel(31)->minutes();
        $this->as($admin)->putJson('/api/v1/admin/players/rowdy/status', ['status' => 'active', 'reason' => 'appeal granted'])->assertOk();
        $this->feed()->assertJsonPath('players', [], 'the mute ran out and the suspension was lifted');
        $this->assertSame(['admin.mute', 'admin.status', 'admin.status'], AuditLog::query()->where('subject_id', $player->public_id)->orderBy('id')->pluck('action')->all());
        $this->assertSame([], $ledger->verify());
    }

    public function test_movement_flags_reach_the_audit_log(): void
    {
        $player = User::factory()->create(['username' => 'zoomer']);
        $admin = User::factory()->create(['roles' => ['admin']]);
        $flag = fn (array $body) => $this->withHeader('Authorization', 'Bearer '.self::TOKEN)->postJson('/api/internal/v1/flags', $body);
        $flag(['world' => 'main', 'player' => $player->public_id, 'kind' => 'speed', 'count' => 12])->assertCreated();
        $flag(['world' => 'main', 'player' => $player->public_id, 'kind' => 'teleport', 'count' => 1])->assertStatus(422);
        $flag(['world' => 'main', 'player' => 'nobody', 'kind' => 'hover', 'count' => 10])->assertNotFound();
        $this->as($admin)->getJson('/api/v1/admin/audit?action=anticheat')->assertJsonCount(1, 'entries')
            ->assertJsonPath('entries.0.action', 'anticheat.speed')->assertJsonPath('entries.0.subject_id', $player->public_id);
        $this->as($admin)->getJson('/api/v1/admin/players/zoomer')->assertJsonPath('audit.0.reason', '12 violations in 5 minutes');
    }

    public function test_the_server_monitor_shows_worlds_and_players(): void
    {
        $admin = User::factory()->create(['roles' => ['admin']]);
        $this->withHeader('Authorization', 'Bearer '.self::TOKEN)
            ->postJson('/api/internal/v1/presence', ['world' => 'main', 'dimension' => 'overworld', 'players' => [$admin->public_id]])->assertOk();
        $this->as($admin)->getJson('/api/v1/admin/servers')->assertOk()
            ->assertJsonPath('worlds.0.world', 'main')->assertJsonPath('worlds.0.players', 1)->assertJsonPath('worlds.0.online', true)
            ->assertJsonPath('online_players', 1)->assertJsonPath('accounts', 1);
    }
}
