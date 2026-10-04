<?php

namespace Tests\Feature;

use App\Models\Friendship;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class WorldTest extends TestCase
{
    use RefreshDatabase;

    private const TOKEN = 'test-game-service-token-0123456789abcdef';

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'platform.game.ticket_secrets' => [str_repeat('k', 40)],
            'platform.internal.service_token' => self::TOKEN,
            'platform.worlds.per_player' => 2,
            'platform.worlds.url_template' => 'ws://w-{world}.test/ws/',
        ]);
    }

    private function as(User $user): static
    {
        Sanctum::actingAs($user);

        return $this;
    }

    private function report(string $world, array $players, string $dimension = 'overworld')
    {
        return $this->withHeader('Authorization', 'Bearer '.self::TOKEN)
            ->postJson('/api/internal/v1/presence', ['world' => $world, 'dimension' => $dimension, 'players' => $players]);
    }

    public function test_players_create_worlds_and_choose_who_joins(): void
    {
        [$owner, $friend, $member, $stranger] = collect(['own', 'pal', 'mem', 'who'])->map(fn ($n) => User::factory()->create(['username' => $n]))->all();
        Friendship::query()->create(['user_id' => $owner->id, 'friend_id' => $friend->id, 'status' => 'accepted', 'accepted_at' => now()]);

        $this->as($owner)->postJson('/api/v1/worlds', ['name' => 'x', 'visibility' => 'public'])->assertStatus(422)->assertJsonPath('error.code', 'bad_name');
        $key = $this->as($owner)->postJson('/api/v1/worlds', ['name' => 'Castle Hill', 'visibility' => 'private', 'realm' => 'creative'])
            ->assertCreated()->assertJsonPath('world.mine', true)->assertJsonPath('world.online', false)->json('world.key');
        $this->assertMatchesRegularExpression('/^w_[a-z0-9]{10}$/', $key);
        $this->as($owner)->postJson('/api/v1/worlds', ['name' => 'Second', 'visibility' => 'public'])->assertCreated();
        $this->as($owner)->postJson('/api/v1/worlds', ['name' => 'Third', 'visibility' => 'public'])->assertStatus(409)->assertJsonPath('error.code', 'too_many_worlds');

        $ticket = fn (User $u) => $this->as($u)->postJson('/api/v1/game/tickets', ['world' => $key]);
        $ticket($owner)->assertCreated()->assertJsonPath('realm', 'creative')->assertJsonPath('url', "ws://w-{$key}.test/ws/");
        $ticket($friend)->assertForbidden()->assertJsonPath('error.code', 'world_closed');
        $this->as($stranger)->getJson('/api/v1/worlds')->assertJsonMissing(['key' => $key]);

        // Friends of the owner, then named members.
        $this->as($owner)->patchJson("/api/v1/worlds/{$key}", ['visibility' => 'friends'])->assertOk();
        $ticket($friend)->assertCreated();
        $ticket($member)->assertForbidden();
        $this->as($friend)->getJson('/api/v1/worlds')->assertJsonFragment(['key' => $key, 'members' => null]);
        $this->as($owner)->postJson("/api/v1/worlds/{$key}/members", ['player' => 'mem'])->assertOk()->assertJsonPath('world.members', ['mem']);
        $ticket($member)->assertCreated();
        $this->as($stranger)->patchJson("/api/v1/worlds/{$key}", ['visibility' => 'public'])->assertNotFound();
        $this->as($owner)->deleteJson("/api/v1/worlds/{$key}/members/mem")->assertOk()->assertJsonPath('world.members', []);
        $ticket($member)->assertForbidden();

        // Full worlds turn players away, but never the owner.
        $this->as($owner)->patchJson("/api/v1/worlds/{$key}", ['max_players' => 1, 'visibility' => 'public'])->assertOk();
        $this->report($key, [$owner->public_id])->assertOk();
        $ticket($stranger)->assertStatus(409)->assertJsonPath('error.code', 'world_full');
        $ticket($owner)->assertCreated();

        $this->as($owner)->deleteJson("/api/v1/worlds/{$key}")->assertOk();
        $ticket($owner)->assertStatus(422);
        $this->withHeader('Authorization', 'Bearer '.self::TOKEN)->getJson('/api/internal/v1/worlds')
            ->assertJsonCount(1, 'worlds')->assertJsonMissing(['key' => $key]);
    }

    public function test_the_browser_shows_who_is_playing_where(): void
    {
        $user = User::factory()->create();
        $other = User::factory()->create();
        $this->as($other)->postJson('/api/v1/worlds', ['name' => 'Open Plains', 'visibility' => 'public'])->assertCreated();

        $this->as($user)->getJson('/api/v1/worlds')->assertOk()
            ->assertJsonPath('worlds.0.key', 'main')->assertJsonPath('worlds.0.official', true)->assertJsonPath('worlds.0.online', false)
            ->assertJsonPath('worlds.1.name', 'Open Plains')->assertJsonPath('worlds.1.players', null);

        $this->report('main', [$user->public_id, $other->public_id]);
        $this->report('main', [], 'underworld');
        $this->as($user)->getJson('/api/v1/worlds')->assertJsonPath('worlds.0.online', true)->assertJsonPath('worlds.0.players', 2);
        $this->report('main', [$user->public_id], 'underworld');
        $this->as($user)->getJson('/api/v1/worlds')->assertJsonPath('worlds.0.players', 3);

        $this->travel(5)->minutes();
        $this->as($user)->getJson('/api/v1/worlds')->assertJsonPath('worlds.0.online', false)->assertJsonPath('worlds.0.players', null);
    }

    public function test_worlds_without_a_server_address_get_no_tickets(): void
    {
        config(['platform.worlds.url_template' => '']);
        $owner = User::factory()->create();
        $key = $this->as($owner)->postJson('/api/v1/worlds', ['name' => 'Nowhere', 'visibility' => 'public'])->json('world.key');
        $this->as($owner)->postJson('/api/v1/game/tickets', ['world' => $key])->assertStatus(409)->assertJsonPath('error.code', 'world_offline');
        $this->as($owner)->postJson('/api/v1/game/tickets', ['world' => 'main'])->assertCreated();
    }
}
