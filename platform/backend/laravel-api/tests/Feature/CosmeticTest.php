<?php

namespace Tests\Feature;

use App\Models\CosmeticUnlock;
use App\Models\User;
use App\Services\Economy\LedgerService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class CosmeticTest extends TestCase
{
    use RefreshDatabase;

    private function claims(string $ticket): array
    {
        [, $payload] = explode('.', $ticket);

        return json_decode(base64_decode(strtr($payload, '-_', '+/')), true);
    }

    public function test_cosmetics_are_bought_with_crowns_and_worn_in_the_ticket(): void
    {
        config(['platform.game.ticket_secrets' => [str_repeat('k', 40)]]);
        $ledger = app(LedgerService::class);
        $user = User::factory()->create();
        Sanctum::actingAs($user);

        $this->getJson('/api/v1/cosmetics')->assertOk()->assertJsonPath('look', null)->assertJsonPath('owned', [])
            ->assertJsonFragment(['key' => 'hat_crown', 'slot' => 'hat', 'price' => 250]);
        $this->postJson('/api/v1/cosmetics/hat_red_cap/buy')->assertStatus(422)->assertJsonPath('error.code', 'insufficient_funds');
        $this->postJson('/api/v1/cosmetics/nothing/buy')->assertNotFound()->assertJsonPath('error.code', 'unknown_cosmetic');
        $this->putJson('/api/v1/cosmetics/equipped', ['slot' => 'hat', 'cosmetic' => 'hat_red_cap'])->assertForbidden()->assertJsonPath('error.code', 'not_owned');

        $ledger->mint($user, 'CRN', 100, 'test', 'grant-1', null, 'system');
        $this->postJson('/api/v1/cosmetics/hat_red_cap/buy')->assertCreated()->assertJsonPath('balance', 75)->assertJsonPath('owned', ['hat_red_cap']);
        $this->postJson('/api/v1/cosmetics/hat_red_cap/buy')->assertOk()->assertJsonPath('balance', 75);
        $this->postJson('/api/v1/cosmetics/outfit_ranger/buy')->assertCreated()->assertJsonPath('balance', 35);
        $this->assertSame(2, CosmeticUnlock::count());
        $this->assertSame([], $ledger->verify());

        $this->putJson('/api/v1/cosmetics/equipped', ['slot' => 'outfit', 'cosmetic' => 'hat_red_cap'])->assertStatus(422)->assertJsonPath('error.code', 'bad_slot');
        $this->putJson('/api/v1/cosmetics/equipped', ['slot' => 'hat', 'cosmetic' => 'hat_red_cap'])->assertOk()
            ->assertJsonPath('equipped.hat', 'hat_red_cap')->assertJsonPath('look.hat.color', '#c0392b');
        $this->putJson('/api/v1/cosmetics/equipped', ['slot' => 'outfit', 'cosmetic' => 'outfit_ranger'])->assertOk()
            ->assertJsonPath('look.outfit.body', '#3d6b35');

        $ticket = $this->postJson('/api/v1/game/tickets', ['world' => 'main'])->assertCreated()->json('ticket');
        $this->assertEquals(['outfit' => ['body' => '#3d6b35', 'arms' => '#2f5229', 'legs' => '#5b4630'], 'hat' => ['color' => '#c0392b']], $this->claims($ticket)['look']);

        $this->putJson('/api/v1/cosmetics/equipped', ['slot' => 'hat', 'cosmetic' => null])->assertOk()->assertJsonPath('look.hat', null);
        $this->putJson('/api/v1/cosmetics/equipped', ['slot' => 'outfit', 'cosmetic' => null])->assertOk()->assertJsonPath('look', null);
        $ticket = $this->postJson('/api/v1/game/tickets', ['world' => 'main'])->assertCreated()->json('ticket');
        $this->assertArrayNotHasKey('look', $this->claims($ticket), 'nothing worn, nothing claimed');
    }
}
