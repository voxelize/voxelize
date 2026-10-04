<?php

namespace Tests\Feature;

use App\Models\GameTicket;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuthAndTicketTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['platform.game.ticket_secrets' => [str_repeat('k', 40)]]);
    }

    public function test_register_login_and_me(): void
    {
        $this->postJson('/api/v1/auth/register', [
            'username' => 'stone_mason',
            'email' => 'mason@example.com',
            'password' => 'correct horse battery',
        ])->assertCreated()->assertJsonPath('user.username', 'stone_mason');

        $token = $this->postJson('/api/v1/auth/login', [
            'login' => 'stone_mason',
            'password' => 'correct horse battery',
        ])->assertOk()->json('token');

        $this->withToken($token)->getJson('/api/v1/me')
            ->assertOk()
            ->assertJsonPath('user.username', 'stone_mason')
            ->assertJsonMissingPath('user.email');
    }

    public function test_registration_creates_an_empty_soft_currency_wallet(): void
    {
        $token = $this->postJson('/api/v1/auth/register', [
            'username' => 'farmer',
            'email' => 'farmer@example.com',
            'password' => 'correct horse battery',
        ])->json('token');

        $this->withToken($token)->getJson('/api/v1/wallets')
            ->assertOk()
            ->assertJsonPath('wallets.0.currency', 'CRN')
            ->assertJsonPath('wallets.0.balance', 0);
    }

    public function test_bad_credentials_and_invalid_usernames_are_rejected(): void
    {
        User::factory()->create(['username' => 'miner', 'email' => 'm@example.com']);

        $this->postJson('/api/v1/auth/login', ['login' => 'miner', 'password' => 'wrong'])
            ->assertUnprocessable();
        $this->postJson('/api/v1/auth/register', [
            'username' => 'bad name!',
            'email' => 'x@example.com',
            'password' => 'correct horse battery',
        ])->assertUnprocessable()->assertJsonValidationErrors('username');
    }

    public function test_ticket_is_issued_recorded_and_carries_the_public_id_only(): void
    {
        $user = User::factory()->create();

        $response = $this->actingAs($user)->postJson('/api/v1/game/tickets', ['world' => 'main'])
            ->assertCreated()
            ->assertJsonPath('realm', 'survival');

        [$version, $payload] = explode('.', $response->json('ticket'));
        $claims = json_decode(base64_decode(strtr($payload, '-_', '+/')), true);
        $this->assertSame('v1', $version);
        $this->assertSame($user->public_id, $claims['sub']);
        $this->assertSame('main', $claims['world']);
        $this->assertLessThanOrEqual(300, $claims['exp'] - $claims['iat']);
        $this->assertTrue(GameTicket::where('jti', $claims['jti'])->where('user_id', $user->id)->exists());
    }

    public function test_granted_roles_travel_in_the_ticket(): void
    {
        $user = User::factory()->create(['username' => 'warden']);
        $claims = function () use ($user) {
            $user->refresh();
            $ticket = $this->actingAs($user)->postJson('/api/v1/game/tickets', ['world' => 'main'])->json('ticket');

            return json_decode(base64_decode(strtr(explode('.', $ticket)[1], '-_', '+/')), true);
        };
        $this->assertSame(['player'], $claims()['roles']);

        $this->artisan('user:role', ['user' => 'warden', 'role' => 'moderator'])->assertSuccessful();
        $this->assertSame(['player', 'moderator'], $claims()['roles']);
        $this->artisan('user:role', ['user' => 'warden', 'role' => 'emperor'])->assertFailed();
        $this->artisan('user:role', ['user' => 'warden', 'role' => 'moderator', '--remove' => true])->assertSuccessful();
        $this->assertSame(['player'], $claims()['roles']);
    }

    public function test_tickets_require_auth_a_known_world_and_an_active_account(): void
    {
        $this->postJson('/api/v1/game/tickets', ['world' => 'main'])->assertUnauthorized();

        $user = User::factory()->create();
        $this->actingAs($user)->postJson('/api/v1/game/tickets', ['world' => 'elsewhere'])
            ->assertUnprocessable();

        $banned = User::factory()->create(['status' => User::STATUS_BANNED]);
        $this->actingAs($banned)->postJson('/api/v1/game/tickets', ['world' => 'main'])
            ->assertForbidden()
            ->assertJsonPath('error.code', 'account_banned');
    }

    public function test_bot_provisioning_creates_usable_accounts_outside_production(): void
    {
        $this->artisan('bots:provision', ['count' => 2])->assertSuccessful();
        $this->assertSame(2, User::where('email', 'like', '%@bots.invalid')->count());

        $this->app['env'] = 'production';
        $this->artisan('bots:provision', ['count' => 1])->assertFailed();
    }
}
