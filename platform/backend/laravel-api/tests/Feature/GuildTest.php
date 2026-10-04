<?php

namespace Tests\Feature;

use App\Models\Guild;
use App\Models\User;
use App\Services\Economy\LedgerService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class GuildTest extends TestCase
{
    use RefreshDatabase;

    private const TOKEN = 'test-game-service-token-0123456789abcdef';

    private LedgerService $ledger;

    private User $leader;

    private User $bob;

    private User $carol;

    protected function setUp(): void
    {
        parent::setUp();
        config(['platform.internal.service_token' => self::TOKEN]);
        $this->ledger = app(LedgerService::class);
        $admin = User::factory()->create(['username' => 'admin']);
        $this->leader = User::factory()->create(['username' => 'leader']);
        $this->bob = User::factory()->create(['username' => 'bob']);
        $this->carol = User::factory()->create(['username' => 'carol']);
        foreach ([$this->leader, $this->bob, $this->carol] as $u) {
            $this->ledger->mint($u, 'CRN', 1000, 'test funding', "seed-{$u->username}", $admin);
        }
    }

    private function found(string $key = 'guild-key-0001')
    {
        Sanctum::actingAs($this->leader);

        return $this->withHeader('Idempotency-Key', $key)->postJson('/api/v1/guilds', ['name' => 'Stone Wardens', 'tag' => 'sw']);
    }

    private function crn(User $u): int
    {
        return $this->ledger->balance($u, 'CRN');
    }

    public function test_founding_charges_the_fee_once_and_one_guild_per_player(): void
    {
        $id = $this->found()->assertCreated()
            ->assertJsonPath('guild.tag', 'SW')->assertJsonPath('guild.my_role', 'leader')->assertJsonPath('balance', 900)
            ->json('guild.id');
        $this->found()->assertOk()->assertJsonPath('replayed', true);
        $this->assertSame(900, $this->crn($this->leader));
        $this->found('guild-key-0002')->assertStatus(409)->assertJsonPath('error.code', 'in_guild');

        Sanctum::actingAs($this->bob);
        $this->withHeader('Idempotency-Key', 'guild-bob-0001')->postJson('/api/v1/guilds', ['name' => 'Other', 'tag' => 'SW'])
            ->assertStatus(409)->assertJsonPath('error.code', 'guild_taken');
        $this->withHeader('Idempotency-Key', 'guild-bob-0002')->postJson('/api/v1/guilds', ['name' => 'x', 'tag' => 'AB'])
            ->assertStatus(422)->assertJsonPath('error.code', 'bad_name');
        $this->getJson('/api/v1/guilds?q=stone')->assertOk()->assertJsonPath('guilds.0.id', $id)->assertJsonPath('guilds.0.members', 1);
        $this->assertSame([], $this->ledger->verify());
    }

    public function test_invites_roles_kicks_and_handover(): void
    {
        $id = $this->found()->json('guild.id');
        Sanctum::actingAs($this->bob);
        $this->postJson("/api/v1/guilds/{$id}/join")->assertStatus(403)->assertJsonPath('error.code', 'not_invited');
        $this->postJson("/api/v1/guilds/{$id}/invites", ['player' => 'carol'])->assertStatus(403);

        Sanctum::actingAs($this->leader);
        $this->postJson("/api/v1/guilds/{$id}/invites", ['player' => 'bob'])->assertOk();
        $this->postJson("/api/v1/guilds/{$id}/invites", ['player' => 'carol'])->assertOk();
        Sanctum::actingAs($this->bob);
        $this->getJson('/api/v1/guilds/mine')->assertJsonPath('guild', null)->assertJsonPath('invites.0.id', $id);
        $this->postJson("/api/v1/guilds/{$id}/join")->assertOk()->assertJsonPath('guild.members', 2)->assertJsonPath('guild.my_role', 'member');
        Sanctum::actingAs($this->carol);
        $this->postJson("/api/v1/guilds/{$id}/join")->assertOk();

        // A plain member may not kick; an officer may kick members, not officers.
        Sanctum::actingAs($this->bob);
        $this->deleteJson("/api/v1/guilds/{$id}/members/carol")->assertStatus(403);
        Sanctum::actingAs($this->leader);
        $this->putJson("/api/v1/guilds/{$id}/members/bob/role", ['role' => 'officer'])->assertOk()->assertJsonPath('guild.roster.1.role', 'officer');
        Sanctum::actingAs($this->bob);
        $this->deleteJson("/api/v1/guilds/{$id}/members/leader")->assertStatus(403);
        $this->deleteJson("/api/v1/guilds/{$id}/members/carol")->assertOk()->assertJsonPath('guild.members', 2);

        // The leader may not walk out of a guild with members; hand over first.
        Sanctum::actingAs($this->leader);
        $this->postJson("/api/v1/guilds/{$id}/leave")->assertStatus(409)->assertJsonPath('error.code', 'leader_must_hand_over');
        $this->putJson("/api/v1/guilds/{$id}/members/bob/role", ['role' => 'leader'])->assertOk()->assertJsonPath('guild.leader.name', 'bob');
        $this->postJson("/api/v1/guilds/{$id}/leave")->assertOk();
        $this->assertSame($this->bob->id, Guild::query()->where('public_id', $id)->value('leader_id'));
    }

    public function test_the_treasury_is_ledger_money(): void
    {
        $id = $this->found()->json('guild.id');
        $this->postJson("/api/v1/guilds/{$id}/invites", ['player' => 'bob'])->assertOk();
        Sanctum::actingAs($this->bob);
        $this->postJson("/api/v1/guilds/{$id}/join")->assertOk();

        $this->withHeader('Idempotency-Key', 'dep-bob-0001')->postJson("/api/v1/guilds/{$id}/deposit", ['amount' => 300])
            ->assertOk()->assertJsonPath('treasury', 300)->assertJsonPath('balance', 700);
        $this->withHeader('Idempotency-Key', 'dep-bob-0001')->postJson("/api/v1/guilds/{$id}/deposit", ['amount' => 300])->assertOk()->assertJsonPath('treasury', 300);
        // Members may not spend it.
        $this->withHeader('Idempotency-Key', 'wd-bob-00001')->postJson("/api/v1/guilds/{$id}/withdraw", ['amount' => 10])->assertStatus(403);
        Sanctum::actingAs($this->carol);
        $this->withHeader('Idempotency-Key', 'dep-carol-001')->postJson("/api/v1/guilds/{$id}/deposit", ['amount' => 5])->assertStatus(403);
        $this->getJson("/api/v1/guilds/{$id}/entries")->assertStatus(403);

        Sanctum::actingAs($this->leader);
        $this->withHeader('Idempotency-Key', 'wd-lead-0001')->postJson("/api/v1/guilds/{$id}/withdraw", ['amount' => 50, 'to' => 'carol'])
            ->assertStatus(404)->assertJsonPath('error.code', 'not_member');
        $this->withHeader('Idempotency-Key', 'wd-lead-0002')->postJson("/api/v1/guilds/{$id}/withdraw", ['amount' => 500, 'to' => 'bob'])->assertStatus(422);
        $this->withHeader('Idempotency-Key', 'wd-lead-0003')->postJson("/api/v1/guilds/{$id}/withdraw", ['amount' => 100, 'to' => 'bob'])
            ->assertOk()->assertJsonPath('treasury', 200);
        $this->assertSame(800, $this->crn($this->bob));
        $this->getJson("/api/v1/guilds/{$id}/entries")->assertOk()->assertJsonCount(2, 'entries');
        $this->assertSame([], $this->ledger->verify());
    }

    public function test_guild_land_is_paid_from_the_treasury_and_shared_with_members(): void
    {
        $id = $this->found()->json('guild.id');
        $this->postJson("/api/v1/guilds/{$id}/invites", ['player' => 'bob'])->assertOk();
        $this->withHeader('Idempotency-Key', 'dep-lead-0001')->postJson("/api/v1/guilds/{$id}/deposit", ['amount' => 400])->assertOk();
        Sanctum::actingAs($this->bob);
        $this->postJson("/api/v1/guilds/{$id}/join")->assertOk();

        $claim = fn (string $key) => $this->withHeader('Idempotency-Key', $key)->postJson('/api/v1/lands', [
            'world' => 'main', 'dimension' => 'overworld', 'min' => [0, 0], 'max' => [1, 1], 'name' => 'Hall', 'guild' => $id,
        ]);
        $claim('land-bob-00001')->assertStatus(403);

        Sanctum::actingAs($this->leader);
        $claim('land-lead-0001')->assertCreated()->assertJsonPath('land.guild.tag', 'SW');
        $this->assertSame(200, $this->getJson("/api/v1/guilds/{$id}")->json('guild.treasury'));
        // The leader's own wallet paid only the founding fee and the deposit.
        $this->assertSame(500, $this->crn($this->leader));

        $land = $this->withHeader('Authorization', 'Bearer '.self::TOKEN)->getJson('/api/internal/v1/lands?world=main')->assertOk()->json('lands.0');
        $this->assertSame('SW', $land['guild']['tag']);
        $this->assertSame($this->leader->public_id, $land['owner']['id']);
        $this->assertContains(['id' => $this->bob->public_id, 'role' => 'builder'], $land['members']);

        Sanctum::actingAs($this->bob);
        $this->getJson('/api/v1/lands?world=main&mine=1')->assertJsonCount(1, 'lands');
        $this->assertSame([], $this->ledger->verify());
    }

    public function test_the_last_member_leaving_disbands_and_pays_out(): void
    {
        $id = $this->found()->json('guild.id');
        $this->withHeader('Idempotency-Key', 'dep-lead-0001')->postJson("/api/v1/guilds/{$id}/deposit", ['amount' => 250])->assertOk();
        $this->withHeader('Idempotency-Key', 'land-lead-0001')->postJson('/api/v1/lands', [
            'world' => 'main', 'dimension' => 'overworld', 'min' => [0, 0], 'max' => [0, 0], 'name' => 'Hut', 'guild' => $id,
        ])->assertCreated();
        $this->assertSame(650, $this->crn($this->leader));
        $this->postJson("/api/v1/guilds/{$id}/leave")->assertOk();
        $this->assertSame(850, $this->crn($this->leader));
        $this->getJson("/api/v1/guilds/{$id}")->assertStatus(404);
        $this->getJson('/api/v1/lands?world=main')->assertJsonCount(0, 'lands');
        // The name is free again.
        $this->found('guild-key-0009')->assertCreated();
        $this->assertSame([], $this->ledger->verify());
    }

    private function guildWithBob(int $deposit = 0): string
    {
        $id = $this->found()->json('guild.id');
        $this->postJson("/api/v1/guilds/{$id}/invites", ['player' => 'bob'])->assertOk();
        if ($deposit > 0) {
            $this->withHeader('Idempotency-Key', 'dep-lead-'.$deposit)->postJson("/api/v1/guilds/{$id}/deposit", ['amount' => $deposit])->assertOk();
        }
        Sanctum::actingAs($this->bob);
        $this->postJson("/api/v1/guilds/{$id}/join")->assertOk();
        Sanctum::actingAs($this->leader);

        return $id;
    }

    private function guildClaim(string $id, array $min, array $max, string $key)
    {
        return $this->withHeader('Idempotency-Key', $key)->postJson('/api/v1/lands', [
            'world' => 'main', 'dimension' => 'overworld', 'min' => $min, 'max' => $max, 'name' => 'Plot', 'guild' => $id,
        ]);
    }

    public function test_touching_guild_lands_grow_into_settlements(): void
    {
        $admin = User::query()->where('username', 'admin')->first();
        $this->ledger->mint($this->leader, 'CRN', 5000, 'more funding', 'seed-leader-2', $admin);
        $id = $this->guildWithBob(4000);

        // Two separate plots of 2 chunks: no settlement yet.
        $this->guildClaim($id, [0, 0], [1, 0], 'land-s-0001')->assertCreated();
        $this->guildClaim($id, [10, 10], [11, 10], 'land-s-0002')->assertCreated();
        $this->getJson("/api/v1/guilds/{$id}")->assertJsonPath('guild.settlement_level', 'none')->assertJsonCount(2, 'guild.settlements');

        // A plot touching the first: one 4-chunk village.
        $this->guildClaim($id, [0, 1], [1, 1], 'land-s-0003')->assertCreated();
        $detail = $this->getJson("/api/v1/guilds/{$id}")->assertJsonPath('guild.settlement_level', 'village')->json('guild');
        $this->assertCount(2, $detail['settlements']);
        $village = collect($detail['settlements'])->firstWhere('level', 'village');
        $this->assertSame(4, $village['chunks']);
        $this->assertSame([0, 0], $village['min']);
        $this->assertSame([1, 1], $village['max']);

        // The feed names the settlement on its lands only.
        $feed = collect($this->withHeader('Authorization', 'Bearer '.self::TOKEN)->getJson('/api/internal/v1/lands?world=main')->json('lands'));
        $this->assertSame(['name' => 'Stone Wardens', 'level' => 'village'], $feed->firstWhere('min', [0, 0])['settlement']);
        $this->assertNull($feed->firstWhere('min', [10, 10])['settlement']);

        // 16 chunks is not a town with two members; a third member makes it one.
        $this->guildClaim($id, [2, 0], [5, 2], 'land-s-0004')->assertCreated();
        $this->getJson("/api/v1/guilds/{$id}")->assertJsonPath('guild.settlement_level', 'village');
        $this->postJson("/api/v1/guilds/{$id}/invites", ['player' => 'carol'])->assertOk();
        Sanctum::actingAs($this->carol);
        $this->postJson("/api/v1/guilds/{$id}/join")->assertOk();
        $this->getJson("/api/v1/guilds/{$id}")->assertJsonPath('guild.settlement_level', 'town')->assertJsonPath('guild.max_members', 75);
    }

    public function test_guild_chat_is_for_members(): void
    {
        $id = $this->guildWithBob();
        $this->postJson("/api/v1/guilds/{$id}/messages", ['body' => "  Meet at the hall\n "])->assertCreated();
        Sanctum::actingAs($this->bob);
        $first = $this->postJson("/api/v1/guilds/{$id}/messages", ['body' => 'On my way'])->assertCreated()->json('message.id');
        $this->postJson("/api/v1/guilds/{$id}/messages", ['body' => "\x01\x02"])->assertStatus(422)->assertJsonPath('error.code', 'bad_message');
        $this->postJson("/api/v1/guilds/{$id}/messages", ['body' => str_repeat('a', 301)])->assertStatus(422);
        $all = $this->getJson("/api/v1/guilds/{$id}/messages")->assertOk()->json('messages');
        $this->assertSame(['Meet at the hall', 'On my way'], array_column($all, 'body'));
        $this->assertSame('leader', $all[0]['from']['name']);
        $this->getJson("/api/v1/guilds/{$id}/messages?after={$first}")->assertJsonCount(0, 'messages');

        Sanctum::actingAs($this->carol);
        $this->getJson("/api/v1/guilds/{$id}/messages")->assertStatus(403);
        $this->postJson("/api/v1/guilds/{$id}/messages", ['body' => 'hi'])->assertStatus(403);

        config(['platform.guilds.chat_per_minute' => 2]);
        Sanctum::actingAs($this->bob);
        $this->postJson("/api/v1/guilds/{$id}/messages", ['body' => 'again'])->assertStatus(429);
    }

    public function test_officers_post_contracts_paid_from_the_treasury(): void
    {
        $id = $this->guildWithBob(300);
        Sanctum::actingAs($this->bob);
        $post = fn (string $key) => $this->withHeader('Idempotency-Key', $key)->postJson('/api/v1/contracts', [
            'world' => 'main', 'item' => 'oak_log', 'count' => 8, 'reward' => 120, 'guild' => $id,
        ]);
        $post('gc-bob-00001')->assertStatus(403);

        Sanctum::actingAs($this->leader);
        $this->putJson("/api/v1/guilds/{$id}/members/bob/role", ['role' => 'officer'])->assertOk();
        Sanctum::actingAs($this->bob);
        $contract = $post('gc-bob-00002')->assertCreated()->assertJsonPath('treasury', 180)->assertJsonPath('balance', 1000)
            ->assertJsonPath('contract.guild.tag', 'SW')->json('contract.id');

        // Another officer (the leader) withdraws it: back to the treasury.
        Sanctum::actingAs($this->leader);
        $this->getJson('/api/v1/contracts?world=main&mine=1')->assertJsonPath('contracts.0.id', $contract);
        $this->deleteJson("/api/v1/contracts/{$contract}")->assertOk();
        $this->assertSame(300, $this->getJson("/api/v1/guilds/{$id}")->json('guild.treasury'));
        Sanctum::actingAs($this->carol);
        $this->assertSame([], $this->ledger->verify());
    }

    public function test_guild_stalls_pay_the_treasury(): void
    {
        $id = $this->guildWithBob();
        $pay = fn (string $key, string $kind, User $to) => $this->withHeader('Authorization', 'Bearer '.self::TOKEN)->postJson('/api/internal/v1/payments', [
            'key' => $key, 'from' => $this->carol->public_id, 'to' => $to->public_id, 'amount' => 100, 'reason' => 'Stall: 4 Bread', 'kind' => $kind,
        ]);
        $pay('stall-guild-01', 'guild_stall', $this->bob)->assertCreated();
        $pay('stall-guild-01', 'guild_stall', $this->bob)->assertOk();
        $this->assertSame(900, $this->crn($this->carol));
        $this->assertSame(1000, $this->crn($this->bob), 'the seller keeps nothing');
        $this->assertSame(95, $this->getJson("/api/v1/guilds/{$id}")->json('guild.treasury'), 'proceeds less the 5% fee');

        // A seller without a guild is paid in person.
        $outsider = User::factory()->create(['username' => 'dave']);
        $pay('stall-guild-02', 'guild_stall', $outsider)->assertCreated();
        $this->assertSame(95, $this->crn($outsider));
        $this->assertSame([], $this->ledger->verify());
    }
}
