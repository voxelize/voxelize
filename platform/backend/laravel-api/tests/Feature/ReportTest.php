<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\PlayerReport;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ReportTest extends TestCase
{
    use RefreshDatabase;

    private const TOKEN = 'test-game-service-token-0123456789abcdef';

    protected function setUp(): void
    {
        parent::setUp();
        config(['platform.internal.service_token' => self::TOKEN]);
    }

    private function as(User $user): static
    {
        Sanctum::actingAs($user);

        return $this;
    }

    private function fromGame(array $body)
    {
        return $this->withHeader('Authorization', 'Bearer '.self::TOKEN)->postJson('/api/internal/v1/reports', $body);
    }

    public function test_players_report_from_the_web_and_see_what_became_of_it(): void
    {
        $ana = User::factory()->create(['username' => 'ana']);
        $bob = User::factory()->create(['username' => 'bob']);

        $this->as($ana)->postJson('/api/v1/reports', ['player' => 'bob', 'category' => 'griefing', 'details' => 'Broke my house'])
            ->assertCreated()->assertJsonPath('report.player', 'bob')->assertJsonPath('report.status', 'open');
        $this->as($ana)->postJson('/api/v1/reports', ['player' => 'bob', 'category' => 'griefing', 'details' => 'Again'])
            ->assertStatus(409)->assertJsonPath('error.code', 'already_reported');
        $this->as($ana)->postJson('/api/v1/reports', ['player' => 'ana', 'category' => 'other', 'details' => 'just me'])
            ->assertStatus(422)->assertJsonPath('error.code', 'self');
        $this->as($ana)->postJson('/api/v1/reports', ['player' => 'nobody', 'category' => 'other', 'details' => 'who'])
            ->assertNotFound();
        $this->as($ana)->postJson('/api/v1/reports', ['player' => 'bob', 'category' => 'rude', 'details' => 'who'])
            ->assertStatus(422);

        $this->as($ana)->getJson('/api/v1/reports')->assertOk()
            ->assertJsonCount(1, 'reports')->assertJsonPath('reports.0.category', 'griefing')
            ->assertJsonMissingPath('reports.0.resolution');
        $this->as($bob)->getJson('/api/v1/reports')->assertOk()->assertJsonCount(0, 'reports');
        $this->assertTrue(AuditLog::query()->where('action', 'report.filed')->where('subject_id', $bob->public_id)->exists());
    }

    public function test_reports_are_rate_limited_per_reporter(): void
    {
        $ana = User::factory()->create(['username' => 'ana']);
        $targets = User::factory()->count(6)->create();
        foreach ($targets->take(5) as $t) {
            $this->as($ana)->postJson('/api/v1/reports', ['player' => $t->public_id, 'category' => 'scam', 'details' => 'took my diamonds'])->assertCreated();
        }
        $this->as($ana)->postJson('/api/v1/reports', ['player' => $targets[5]->public_id, 'category' => 'scam', 'details' => 'took my diamonds'])
            ->assertStatus(429)->assertJsonPath('error.code', 'too_many_reports');
        $this->travel(61)->minutes();
        $this->as($ana)->postJson('/api/v1/reports', ['player' => $targets[5]->public_id, 'category' => 'scam', 'details' => 'took my diamonds'])->assertCreated();
    }

    public function test_game_servers_file_reports_with_what_they_saw(): void
    {
        $ana = User::factory()->create(['username' => 'ana']);
        $bob = User::factory()->create(['username' => 'bob']);
        $context = ['reporter_at' => [1, 2, 3], 'target_at' => [4, 5, 6], 'target_lines' => ['you are bad']];

        $this->fromGame(['world' => 'main', 'reporter' => $ana->public_id, 'target' => $bob->public_id, 'reason' => 'Harassment keeps insulting me', 'context' => $context])
            ->assertCreated()->assertJsonPath('category', 'harassment');
        $report = PlayerReport::query()->firstOrFail();
        $this->assertSame('game', $report->source);
        $this->assertSame('keeps insulting me', $report->details);
        $this->assertSame(['you are bad'], $report->context['target_lines']);

        $this->fromGame(['world' => 'main', 'reporter' => $bob->public_id, 'target' => $ana->public_id, 'reason' => 'flying around'])
            ->assertCreated()->assertJsonPath('category', 'other');
        $this->fromGame(['world' => 'main', 'reporter' => $bob->public_id, 'target' => $ana->public_id, 'reason' => 'again'])
            ->assertStatus(409)->assertJsonPath('error.code', 'already_reported');
        $this->fromGame(['world' => 'main', 'reporter' => 'nobody', 'target' => $ana->public_id, 'reason' => 'x y z'])->assertNotFound();
        $this->flushHeaders()->postJson('/api/internal/v1/reports', ['world' => 'main', 'reporter' => $bob->public_id, 'target' => $ana->public_id, 'reason' => 'x y z'])
            ->assertUnauthorized();
    }

    public function test_moderators_review_and_close_reports(): void
    {
        $ana = User::factory()->create(['username' => 'ana']);
        $bob = User::factory()->create(['username' => 'bob']);
        $cy = User::factory()->create(['username' => 'cyd']);
        $mod = User::factory()->create(['username' => 'mod', 'roles' => ['moderator']]);
        $this->as($ana)->postJson('/api/v1/reports', ['player' => 'bob', 'category' => 'cheating', 'details' => 'flies'])->assertCreated();
        $this->as($cy)->postJson('/api/v1/reports', ['player' => 'bob', 'category' => 'cheating', 'details' => 'speed'])->assertCreated();
        $id = $this->as($cy)->postJson('/api/v1/reports', ['player' => 'mod', 'category' => 'other', 'details' => 'unfair'])->assertCreated()->json('report.id');

        $this->as($ana)->getJson('/api/v1/admin/reports')->assertForbidden();
        $list = $this->as($mod)->getJson('/api/v1/admin/reports')->assertOk()->assertJsonPath('open', 3);
        $first = $list->json('reports.0');
        $this->assertSame('bob', $first['target']['username']);
        $this->assertSame('ana', $first['reporter']['username']);
        $this->assertSame(2, $first['open_about_target']);
        $this->as($mod)->getJson('/api/v1/admin/reports?player=bob')->assertJsonCount(2, 'reports');
        $this->as($mod)->getJson('/api/v1/admin/players/bob')->assertJsonPath('player.reports_open', 2);

        $this->as($mod)->postJson("/api/v1/admin/reports/{$id}", ['outcome' => 'dismissed', 'note' => 'mine'])
            ->assertStatus(422)->assertJsonPath('error.code', 'self');
        $this->as($mod)->postJson("/api/v1/admin/reports/{$first['id']}", ['outcome' => 'resolved', 'note' => 'muted for an hour'])
            ->assertOk()->assertJsonPath('report.status', 'resolved')->assertJsonPath('report.handled_by', 'mod');
        $this->as($mod)->postJson("/api/v1/admin/reports/{$first['id']}", ['outcome' => 'dismissed', 'note' => 'again'])
            ->assertStatus(409)->assertJsonPath('error.code', 'already_handled');
        $this->as($mod)->getJson('/api/v1/admin/reports?status=resolved')->assertJsonCount(1, 'reports')
            ->assertJsonPath('reports.0.resolution', 'muted for an hour');
        $this->as($ana)->getJson('/api/v1/reports')->assertJsonPath('reports.0.status', 'resolved');
        $this->assertTrue(AuditLog::query()->where('action', 'admin.report')->where('reason', 'muted for an hour')->exists());
    }
}
