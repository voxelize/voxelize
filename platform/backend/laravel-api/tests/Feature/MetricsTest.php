<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\Economy\LedgerService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class MetricsTest extends TestCase
{
    use RefreshDatabase;

    private const TOKEN = 'test-game-service-token-0123456789abcdef';

    public function test_business_metrics_are_scraped_with_the_service_token(): void
    {
        config(['platform.internal.service_token' => self::TOKEN]);
        $this->get('/api/internal/v1/metrics')->assertStatus(401);
        $user = User::factory()->create();
        User::factory()->create(['status' => 'banned']);
        app(LedgerService::class)->mint($user, 'CRN', 120, 'test', 'm-1', null, 'system');
        $this->withHeader('Authorization', 'Bearer '.self::TOKEN)
            ->postJson('/api/internal/v1/presence', ['world' => 'main', 'dimension' => 'overworld', 'players' => [$user->public_id]])->assertOk();

        $body = $this->withHeader('Authorization', 'Bearer '.self::TOKEN)->get('/api/internal/v1/metrics')
            ->assertOk()->assertHeader('Content-Type', 'text/plain; version=0.0.4; charset=UTF-8')->getContent();

        $this->assertStringContainsString("# TYPE platform_accounts gauge\n", $body);
        $this->assertStringContainsString('platform_accounts{status="active"} 1', $body);
        $this->assertStringContainsString('platform_accounts{status="banned"} 1', $body);
        $this->assertStringContainsString("platform_players_online 1\n", $body);
        $this->assertStringContainsString('platform_world_players{world="main",dimension="overworld"} 1', $body);
        $this->assertStringContainsString('platform_money_supply{currency="CRN"} 120', $body);
    }
}
