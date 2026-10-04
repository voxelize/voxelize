<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\Economy\LedgerService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class GuildDiplomacyTest extends TestCase
{
    use RefreshDatabase;

    private const TOKEN = 'test-game-service-token-0123456789abcdef';

    private LedgerService $ledger;

    /** @var array<string, User> */
    private array $u = [];

    protected function setUp(): void
    {
        parent::setUp();
        config(['platform.internal.service_token' => self::TOKEN, 'platform.guilds.war.warmup_minutes' => 10]);
        $this->ledger = app(LedgerService::class);
        $admin = User::factory()->create(['username' => 'admin']);
        foreach (['ann', 'amy', 'bob', 'ben', 'cat', 'buyer'] as $name) {
            $this->u[$name] = User::factory()->create(['username' => $name]);
            $this->ledger->mint($this->u[$name], 'CRN', 1000, 'funding', "seed-{$name}", $admin);
        }
    }

    /** A guild led by `$leader` with `$member`, and `$deposit` in its treasury. */
    private function guild(string $leader, string $member, string $name, string $tag, int $deposit = 500): string
    {
        Sanctum::actingAs($this->u[$leader]);
        $id = $this->withHeader('Idempotency-Key', "found-{$tag}-0001")->postJson('/api/v1/guilds', ['name' => $name, 'tag' => $tag])->assertCreated()->json('guild.id');
        $this->postJson("/api/v1/guilds/{$id}/invites", ['player' => $member])->assertOk();
        if ($deposit > 0) {
            $this->withHeader('Idempotency-Key', "dep-{$tag}-00001")->postJson("/api/v1/guilds/{$id}/deposit", ['amount' => $deposit])->assertOk();
        }
        Sanctum::actingAs($this->u[$member]);
        $this->postJson("/api/v1/guilds/{$id}/join")->assertOk();

        return $id;
    }

    private function feed()
    {
        return collect($this->withHeader('Authorization', 'Bearer '.self::TOKEN)->getJson('/api/internal/v1/guilds')->assertOk()->json('guilds'));
    }

    private function kill(string $key, string $killer, string $victim)
    {
        return $this->withHeader('Authorization', 'Bearer '.self::TOKEN)->postJson('/api/internal/v1/wars/kills', [
            'key' => $key, 'killer' => $this->u[$killer]->public_id, 'victim' => $this->u[$victim]->public_id,
        ]);
    }

    public function test_alliances_need_both_leaders_and_let_allies_visit(): void
    {
        $a = $this->guild('ann', 'amy', 'Alpha', 'AA');
        $b = $this->guild('bob', 'ben', 'Bravo', 'BB');

        Sanctum::actingAs($this->u['amy']);
        $this->postJson("/api/v1/guilds/{$a}/alliances", ['guild' => 'BB'])->assertStatus(403);
        Sanctum::actingAs($this->u['ann']);
        $this->postJson("/api/v1/guilds/{$a}/alliances", ['guild' => 'BB'])->assertCreated()->assertJsonPath('relation.status', 'proposed');
        $this->postJson("/api/v1/guilds/{$a}/alliances", ['guild' => 'AA'])->assertStatus(422);
        $this->assertSame([], $this->feed()->firstWhere('tag', 'AA')['allies']);

        Sanctum::actingAs($this->u['bob']);
        $this->getJson("/api/v1/guilds/{$b}")->assertJsonPath('guild.relations.0.initiated', false);
        $this->postJson("/api/v1/guilds/{$b}/alliances", ['guild' => $a])->assertCreated()->assertJsonPath('relation.status', 'active');
        $this->assertSame([$b], $this->feed()->firstWhere('tag', 'AA')['allies']);

        // Allies visit each other's guild land.
        Sanctum::actingAs($this->u['ann']);
        $this->withHeader('Idempotency-Key', 'land-aa-0001')->postJson('/api/v1/lands', [
            'world' => 'main', 'dimension' => 'overworld', 'min' => [0, 0], 'max' => [0, 0], 'name' => 'Hall', 'guild' => $a,
        ])->assertCreated();
        $land = $this->withHeader('Authorization', 'Bearer '.self::TOKEN)->getJson('/api/internal/v1/lands?world=main')->json('lands.0');
        $this->assertContains(['id' => $this->u['ben']->public_id, 'role' => 'visitor'], $land['members']);

        // No war between allies; ending the alliance first.
        $this->postJson("/api/v1/guilds/{$a}/wars", ['guild' => 'BB'])->assertStatus(409)->assertJsonPath('error.code', 'allied');
        $this->deleteJson("/api/v1/guilds/{$a}/alliances/BB")->assertOk();
        $this->assertSame([], $this->feed()->firstWhere('tag', 'AA')['allies']);
    }

    public function test_wars_cost_a_fee_start_after_a_warm_up_score_kills_and_end_in_peace(): void
    {
        $a = $this->guild('ann', 'amy', 'Alpha', 'AA');
        $b = $this->guild('bob', 'ben', 'Bravo', 'BB');

        Sanctum::actingAs($this->u['ann']);
        $this->postJson("/api/v1/guilds/{$a}/wars", ['guild' => 'BB'])->assertCreated()->assertJsonPath('relation.fighting', false);
        $this->postJson("/api/v1/guilds/{$a}/wars", ['guild' => 'BB'])->assertCreated();
        $this->assertSame(300, $this->getJson("/api/v1/guilds/{$a}")->json('guild.treasury'), 'the 200 fee, once');
        $this->assertSame([], $this->feed()->firstWhere('tag', 'AA')['wars'], 'not yet: warm-up');
        $this->kill('kill-0000001', 'amy', 'ben')->assertStatus(409);

        $this->travel(11)->minutes();
        $this->assertSame([$b], $this->feed()->firstWhere('tag', 'AA')['wars']);
        $this->assertSame([$a], $this->feed()->firstWhere('tag', 'BB')['wars']);
        $this->kill('kill-0000002', 'amy', 'ben')->assertOk();
        $this->kill('kill-0000002', 'amy', 'ben')->assertOk();
        $this->kill('kill-0000003', 'ben', 'ann')->assertOk();
        $this->kill('kill-0000004', 'amy', 'buyer')->assertStatus(409);
        $war = $this->getJson("/api/v1/guilds/{$a}/relations")->json('relations.0');
        $this->assertSame(['us' => 1, 'them' => 1], $war['score']);
        $this->assertTrue($war['fighting']);

        // Peace takes both leaders.
        $this->postJson("/api/v1/guilds/{$a}/wars/BB/peace")->assertOk()->assertJsonPath('offered', true);
        $this->assertSame([$b], $this->feed()->firstWhere('tag', 'AA')['wars']);
        Sanctum::actingAs($this->u['bob']);
        $this->getJson("/api/v1/guilds/{$b}/relations")->assertJsonPath('relations.0.peace_offered', 'them');
        $this->postJson("/api/v1/guilds/{$b}/wars/AA/peace")->assertOk()->assertJsonPath('peace', true);
        $this->assertSame([], $this->feed()->firstWhere('tag', 'AA')['wars']);
        $this->assertSame([], $this->ledger->verify());
    }

    public function test_wars_end_by_themselves(): void
    {
        $this->guild('ann', 'amy', 'Alpha', 'AA');
        $this->guild('bob', 'ben', 'Bravo', 'BB');
        Sanctum::actingAs($this->u['ann']);
        $this->postJson('/api/v1/guilds/'.$this->feed()->firstWhere('tag', 'AA')['id'].'/wars', ['guild' => 'BB'])->assertCreated();
        $this->travel(8)->days();
        $this->assertSame([], $this->feed()->firstWhere('tag', 'AA')['wars']);
        $this->assertSame([], $this->getJson('/api/v1/guilds/'.$this->feed()->firstWhere('tag', 'AA')['id'].'/relations')->json('relations'));
    }

    public function test_guilds_tax_stall_sales_on_their_land(): void
    {
        $a = $this->guild('ann', 'amy', 'Alpha', 'AA', 0);
        Sanctum::actingAs($this->u['amy']);
        $this->putJson("/api/v1/guilds/{$a}/tax", ['bps' => 1000])->assertStatus(403);
        Sanctum::actingAs($this->u['ann']);
        $this->putJson("/api/v1/guilds/{$a}/tax", ['bps' => 2500])->assertStatus(422)->assertJsonPath('error.code', 'bad_tax');
        $this->putJson("/api/v1/guilds/{$a}/tax", ['bps' => 1000])->assertOk()->assertJsonPath('guild.tax_bps', 1000);

        $pay = fn (string $key, User $seller, string $kind = 'stall') => $this->withHeader('Authorization', 'Bearer '.self::TOKEN)->postJson('/api/internal/v1/payments', [
            'key' => $key, 'from' => $this->u['buyer']->public_id, 'to' => $seller->public_id, 'amount' => 200,
            'reason' => 'Stall: 1 Bread', 'kind' => $kind, 'land_guild' => $a,
        ]);
        // A stranger's stall on Alpha land: 10% tax, 5% fee.
        $pay('stall-tax-0001', $this->u['cat'])->assertCreated();
        $this->assertSame(1000 + 200 - 10 - 20, $this->ledger->balance($this->u['cat'], 'CRN'));
        $this->assertSame(20, $this->getJson("/api/v1/guilds/{$a}")->json('guild.treasury'));
        // Alpha's own guild stall pays no tax to itself.
        $pay('stall-tax-0002', $this->u['amy'], 'guild_stall')->assertCreated();
        $this->assertSame(20 + 190, $this->getJson("/api/v1/guilds/{$a}")->json('guild.treasury'));
        $this->assertSame([], $this->ledger->verify());
    }
}
