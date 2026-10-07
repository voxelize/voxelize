<?php

namespace Tests\Feature;

use App\Models\Friendship;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class FriendTest extends TestCase
{
    use RefreshDatabase;

    private const TOKEN = 'test-game-service-token-0123456789abcdef';

    protected function setUp(): void
    {
        parent::setUp();
        config(['platform.internal.service_token' => self::TOKEN, 'platform.friends.limit' => 2]);
    }

    private function as(User $user): static
    {
        Sanctum::actingAs($user);

        return $this;
    }

    public function test_a_request_is_accepted_and_either_side_can_end_it(): void
    {
        [$ana, $bo] = [User::factory()->create(['username' => 'ana']), User::factory()->create(['username' => 'bo'])];

        $this->as($ana)->postJson('/api/v1/friends', ['player' => 'ana'])->assertStatus(422)->assertJsonPath('error.code', 'self');
        $this->as($ana)->postJson('/api/v1/friends', ['player' => 'nobody'])->assertNotFound();
        $this->as($ana)->postJson('/api/v1/friends', ['player' => 'bo'])->assertCreated()->assertJsonPath('status', 'pending');
        $this->as($ana)->postJson('/api/v1/friends', ['player' => 'bo'])->assertOk()->assertJsonPath('status', 'pending');
        $this->as($ana)->getJson('/api/v1/friends')->assertJsonPath('outgoing.0.username', 'bo')->assertJsonCount(0, 'friends');
        $this->as($bo)->getJson('/api/v1/friends')->assertJsonPath('incoming.0.username', 'ana');
        $this->as($ana)->postJson('/api/v1/friends/bo/accept')->assertNotFound()->assertJsonPath('error.code', 'no_request');

        $this->as($bo)->postJson('/api/v1/friends/ana/accept')->assertOk()->assertJsonPath('status', 'accepted');
        $this->as($ana)->getJson('/api/v1/friends')->assertJsonPath('friends.0.username', 'bo')
            ->assertJsonPath('friends.0.online', false)->assertJsonCount(0, 'incoming')->assertJsonCount(0, 'outgoing');
        $this->as($bo)->postJson('/api/v1/friends', ['player' => 'ana'])->assertStatus(409)->assertJsonPath('error.code', 'already_friends');

        $this->as($ana)->deleteJson('/api/v1/friends/bo')->assertOk()->assertJsonPath('removed', true);
        $this->assertSame(0, Friendship::count());
        $this->as($bo)->getJson('/api/v1/friends')->assertJsonCount(0, 'friends');
    }

    public function test_asking_back_accepts_and_the_list_is_limited(): void
    {
        $ana = User::factory()->create(['username' => 'ana']);
        $others = collect(['bo', 'cy', 'di'])->map(fn ($n) => User::factory()->create(['username' => $n]));

        $this->as($others[0])->postJson('/api/v1/friends', ['player' => 'ana'])->assertCreated();
        $this->as($ana)->postJson('/api/v1/friends', ['player' => 'bo'])->assertOk()->assertJsonPath('status', 'accepted');
        $this->as($ana)->postJson('/api/v1/friends', ['player' => 'cy'])->assertCreated();
        $this->as($others[1])->postJson('/api/v1/friends/ana/accept')->assertOk();
        $this->as($ana)->postJson('/api/v1/friends', ['player' => 'di'])->assertStatus(409)->assertJsonPath('error.code', 'too_many_friends');
        // Declining a request removes it.
        $this->as($others[2])->postJson('/api/v1/friends', ['player' => 'ana'])->assertCreated();
        $this->as($ana)->deleteJson('/api/v1/friends/di')->assertJsonPath('removed', true);
        $this->as($others[2])->getJson('/api/v1/friends')->assertJsonCount(0, 'outgoing');
    }

    public function test_game_servers_report_who_is_online(): void
    {
        [$ana, $bo, $cy] = [
            User::factory()->create(['username' => 'ana']),
            User::factory()->create(['username' => 'bo']),
            User::factory()->create(['username' => 'cy']),
        ];
        Friendship::query()->create(['user_id' => $ana->id, 'friend_id' => $bo->id, 'status' => 'accepted', 'accepted_at' => now()]);
        Friendship::query()->create(['user_id' => $cy->id, 'friend_id' => $ana->id, 'status' => 'accepted', 'accepted_at' => now()]);

        $this->postJson('/api/internal/v1/presence', ['world' => 'main', 'players' => []])->assertStatus(401);
        $this->withHeader('Authorization', 'Bearer '.self::TOKEN)
            ->postJson('/api/internal/v1/presence', ['world' => 'main', 'players' => [$cy->public_id, 'unknown']])
            ->assertOk()->assertJsonPath('seen', 1);

        $this->as($ana)->getJson('/api/v1/friends')
            ->assertJsonPath('friends.0.username', 'cy')->assertJsonPath('friends.0.online', true)->assertJsonPath('friends.0.world', 'main')
            ->assertJsonPath('friends.1.username', 'bo')->assertJsonPath('friends.1.online', false);

        // Presence is kept in the cache; the database only learns "last seen"
        // every five minutes, unless the player changes worlds.
        $first = $cy->fresh()->last_seen_at;
        $this->travel(1)->minutes();
        $report = fn (string $world) => $this->withHeader('Authorization', 'Bearer '.self::TOKEN)
            ->postJson('/api/internal/v1/presence', ['world' => $world, 'players' => [$cy->public_id]])->assertOk();
        $report('main');
        $this->assertEquals($first, $cy->fresh()->last_seen_at, 'no write a minute later');
        $report('w_abcdefghij');
        $this->assertSame('w_abcdefghij', $cy->fresh()->last_world, 'a new world is written at once');
        $this->as($ana)->getJson('/api/v1/friends')->assertJsonPath('friends.0.world', 'w_abcdefghij');

        $this->travel(2)->minutes();
        $this->as($ana)->getJson('/api/v1/friends')->assertJsonPath('friends.0.username', 'bo')
            ->assertJsonPath('friends.1.online', false)->assertJsonPath('friends.1.world', null);
    }
}
