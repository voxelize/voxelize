<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Friendship;
use App\Models\Land;
use App\Models\User;
use App\Notifications\ResetPasswordLink;
use App\Notifications\VerifyEmailLink;
use App\Services\Economy\LedgerService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AccountTest extends TestCase
{
    use RefreshDatabase;

    private const TOKEN = 'test-game-service-token-0123456789abcdef';

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'platform.game.ticket_secrets' => [str_repeat('k', 40)],
            'platform.internal.service_token' => self::TOKEN,
            'platform.auth.client_url' => 'https://play.example',
        ]);
    }

    public function test_a_forgotten_password_is_reset_by_email_link(): void
    {
        Notification::fake();
        $this->postJson('/api/v1/auth/register', ['username' => 'ana', 'email' => 'ana@example.com', 'password' => 'old password 123'])->assertCreated();
        $user = User::query()->where('username', 'ana')->first();
        $old = $this->postJson('/api/v1/auth/login', ['login' => 'ana', 'password' => 'old password 123'])->json('token');

        // Same answer for an unknown address: nothing learned.
        $this->postJson('/api/v1/auth/password/forgot', ['email' => 'nobody@example.com'])->assertStatus(202);
        $this->postJson('/api/v1/auth/password/forgot', ['email' => 'ana@example.com'])->assertStatus(202);
        $token = null;
        Notification::assertSentTo($user, ResetPasswordLink::class, function (ResetPasswordLink $n) use (&$token, $user) {
            $token = $n->token;

            return str_starts_with($n->url($user), 'https://play.example/?reset=');
        });

        $this->postJson('/api/v1/auth/password/reset', ['email' => 'ana@example.com', 'token' => 'wrong', 'password' => 'new password 456'])
            ->assertStatus(422)->assertJsonPath('error.code', 'invalid_reset');
        $this->postJson('/api/v1/auth/password/reset', ['email' => 'ana@example.com', 'token' => $token, 'password' => 'new password 456'])->assertOk();
        $this->postJson('/api/v1/auth/password/reset', ['email' => 'ana@example.com', 'token' => $token, 'password' => 'another one 789'])
            ->assertStatus(422);
        $this->assertSame(0, $user->tokens()->count(), 'old sessions end');
        $this->app['auth']->forgetGuards();
        $this->withToken($old)->getJson('/api/v1/me')->assertUnauthorized();
        $this->postJson('/api/v1/auth/login', ['login' => 'ana', 'password' => 'new password 456'])->assertOk();
        $this->assertTrue(AuditLog::query()->where('action', 'account.password_reset')->exists());
    }

    public function test_the_address_is_confirmed_by_a_signed_link(): void
    {
        Notification::fake();
        $this->postJson('/api/v1/auth/register', ['username' => 'bob', 'email' => 'bo@example.com', 'password' => 'a password 123'])
            ->assertCreated()->assertJsonPath('user.email_verified', false);
        $user = User::query()->where('username', 'bob')->first();
        $url = null;
        Notification::assertSentTo($user, VerifyEmailLink::class, function (VerifyEmailLink $n) use (&$url, $user) {
            $url = $n->url($user);

            return true;
        });

        // Tickets can require a confirmed address.
        config(['platform.auth.require_verified_email' => true]);
        Sanctum::actingAs($user);
        $this->postJson('/api/v1/game/tickets', ['world' => 'main'])->assertForbidden()->assertJsonPath('error.code', 'email_unverified');

        $this->get($url.'x')->assertForbidden();
        $this->get($url)->assertRedirect('https://play.example/?verified=1');
        $this->assertNotNull($user->fresh()->email_verified_at);
        Sanctum::actingAs($user->fresh());
        $this->postJson('/api/v1/game/tickets', ['world' => 'main'])->assertCreated();
        $this->postJson('/api/v1/me/email/verification')->assertOk()->assertJsonPath('verified', true);
    }

    public function test_the_password_is_changed_while_signed_in(): void
    {
        $user = User::factory()->create(['password' => 'first password 1']);
        $other = $user->createToken('phone')->plainTextToken;
        $mine = $user->createToken('web')->plainTextToken;
        $this->withToken($mine)->putJson('/api/v1/me/password', ['current' => 'nope', 'password' => 'second password 2'])
            ->assertStatus(422)->assertJsonPath('error.code', 'wrong_password');
        $this->withToken($mine)->putJson('/api/v1/me/password', ['current' => 'first password 1', 'password' => 'second password 2'])->assertOk();
        $this->app['auth']->forgetGuards();
        $this->withToken($other)->getJson('/api/v1/me')->assertUnauthorized();
        $this->app['auth']->forgetGuards();
        $this->withToken($mine)->getJson('/api/v1/me')->assertOk();
    }

    public function test_players_take_their_data_away_and_delete_their_account(): void
    {
        $ledger = app(LedgerService::class);
        $user = User::factory()->create(['username' => 'leaver', 'password' => 'my password 123']);
        $friend = User::factory()->create(['username' => 'pal']);
        Friendship::query()->create(['user_id' => $user->id, 'friend_id' => $friend->id, 'status' => 'accepted', 'accepted_at' => now()]);
        $ledger->mint($user, 'CRN', 500, 'test', 'g-1', null, 'system');
        DB::table('player_states')->insert(['world' => 'main', 'player' => $user->public_id, 'dimension' => 'overworld', 'record_version' => 1,
            'record' => json_encode(['inventory' => ['slots' => []]]), 'xp' => 3, 'revision' => 1, 'updated_at' => now()]);
        Sanctum::actingAs($user);
        $this->postJson('/api/v1/lands', ['world' => 'main', 'dimension' => 'overworld', 'min' => [0, 0], 'max' => [0, 0], 'name' => 'Home'],
            ['Idempotency-Key' => 'land-key-0001'])->assertCreated();
        $world = $this->postJson('/api/v1/worlds', ['name' => 'Mine', 'visibility' => 'public'])->json('world.key');

        $export = $this->getJson('/api/v1/me/export')->assertOk()->assertHeader('Content-Disposition', 'attachment; filename="platform-account.json"');
        $this->assertSame('leaver', $export->json('account.username'));
        $this->assertSame('pal', $export->json('friends.0.with'));
        $this->assertSame('main', $export->json('game.0.world'));
        $this->assertSame(1, count($export->json('lands')));

        $this->deleteJson('/api/v1/me', ['password' => 'wrong'])->assertStatus(422)->assertJsonPath('error.code', 'wrong_password');
        $this->deleteJson('/api/v1/me', ['password' => 'my password 123'])->assertOk();

        $gone = $user->fresh();
        $this->assertSame(User::STATUS_DELETED, $gone->status);
        $this->assertStringStartsWith('deleted_', $gone->username);
        $this->assertStringEndsWith('@deleted.invalid', $gone->email);
        $this->assertSame(0, Friendship::query()->count());
        $this->assertSame(0, DB::table('player_states')->count());
        $this->assertSame('released', Land::query()->first()->status);
        $this->assertSame('archived', DB::table('worlds')->where('public_id', $world)->value('status'));
        $this->assertSame([], $ledger->verify(), 'the books still balance');
        $this->assertSame(0, $gone->tokens()->count());
        $this->postJson('/api/v1/auth/login', ['login' => 'leaver', 'password' => 'my password 123'])->assertStatus(422);
        // Game servers are told: the account is out of play.
        $this->withHeader('Authorization', 'Bearer '.self::TOKEN)->getJson('/api/internal/v1/sanctions')
            ->assertJsonPath('players.0.id', $gone->public_id)->assertJsonPath('players.0.status', 'deleted');
        // The name is free again.
        $this->postJson('/api/v1/auth/register', ['username' => 'leaver', 'email' => 'new@example.com', 'password' => 'a password 123'])->assertCreated();
    }

    public function test_deleting_waits_while_others_depend_on_the_player(): void
    {
        $leader = User::factory()->create(['password' => 'my password 123']);
        $member = User::factory()->create();
        app(LedgerService::class)->mint($leader, 'CRN', 5000, 'test', 'g-2', null, 'system');
        Sanctum::actingAs($leader);
        $guild = $this->postJson('/api/v1/guilds', ['name' => 'Keepers', 'tag' => 'KEEP'], ['Idempotency-Key' => 'guild-key-0001'])->json('guild.id');
        $this->postJson("/api/v1/guilds/{$guild}/invites", ['player' => $member->username])->assertOk();
        Sanctum::actingAs($member);
        $this->postJson("/api/v1/guilds/{$guild}/join")->assertOk();
        Sanctum::actingAs($leader);
        $this->deleteJson('/api/v1/me', ['password' => 'my password 123'])->assertStatus(409)->assertJsonPath('error.code', 'leader_must_hand_over');
        $this->assertSame(User::STATUS_ACTIVE, $leader->fresh()->status);
    }
}
