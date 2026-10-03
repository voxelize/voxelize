<?php

namespace Tests\Unit;

use App\Services\Game\TicketIssuer;
use PHPUnit\Framework\TestCase;

/**
 * The PHP issuer must produce byte-identical tickets to the independent
 * reference implementation that generated the shared vectors, which the
 * Rust verifier (platform/crates/ticket) also checks.
 */
class TicketIssuerTest extends TestCase
{
    private function vectors(): array
    {
        $path = __DIR__.'/../../../../tests/fixtures/game-ticket-vectors.json';

        return json_decode(file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);
    }

    public function test_signing_matches_the_shared_vector(): void
    {
        $vectors = $this->vectors();
        $valid = collect($vectors['cases'])->firstWhere('name', 'valid');

        $this->assertSame($valid['token'], TicketIssuer::sign($vectors['claims'], $vectors['secret']));
    }

    public function test_a_different_secret_gives_a_different_signature(): void
    {
        $vectors = $this->vectors();
        $token = TicketIssuer::sign($vectors['claims'], str_repeat('x', 40));

        $this->assertStringStartsWith('v1.', $token);
        $this->assertNotSame(collect($vectors['cases'])->firstWhere('name', 'valid')['token'], $token);
    }
}
