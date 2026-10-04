<?php

namespace App\Services\Game;

use App\Models\GameTicket;
use App\Models\User;
use App\Services\Social\CosmeticService;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * Issues the short-lived, single-use tickets game servers admit players
 * with (docs/SECURITY.md, "Game tickets"). The format is shared with the
 * Rust verifier in platform/crates/ticket and pinned by common test vectors.
 */
class TicketIssuer
{
    /**
     * @return array{ticket: string, expires_at: int, world: string, realm: string, url: string}
     */
    public function issue(User $user, string $world, ?string $ip = null): array
    {
        $worlds = config('platform.game.worlds');
        if (! isset($worlds[$world])) {
            throw new RuntimeException("Unknown world {$world}.");
        }
        $now = now()->getTimestamp();
        $claims = [
            'iss' => config('platform.game.ticket_issuer'),
            'aud' => config('platform.game.ticket_audience'),
            'sub' => $user->public_id,
            'name' => $user->username,
            'world' => $world,
            'realm' => $worlds[$world]['realm'],
            'roles' => $user->gameRoles(),
            'iat' => $now,
            'exp' => $now + (int) config('platform.game.ticket_ttl_seconds'),
            'jti' => (string) Str::ulid(),
        ];

        // What the player wears, for everyone in the world to see.
        if ($look = app(CosmeticService::class)->look($user)) {
            $claims['look'] = $look;
        }

        $ticket = self::sign($claims, $this->signingSecret());

        GameTicket::create([
            'jti' => $claims['jti'],
            'user_id' => $user->id,
            'world' => $world,
            'realm' => $claims['realm'],
            'issued_at' => now()->setTimestamp($claims['iat']),
            'expires_at' => now()->setTimestamp($claims['exp']),
            'ip_address' => $ip,
        ]);

        return [
            'ticket' => $ticket,
            'expires_at' => $claims['exp'],
            'world' => $world,
            'realm' => $claims['realm'],
            'url' => $worlds[$world]['url'],
        ];
    }

    /**
     * `v1.<b64url(json claims)>.<b64url(hmac-sha256(secret, "v1." + payload))>`.
     *
     * @param  array<string, mixed>  $claims
     */
    public static function sign(array $claims, string $secret): string
    {
        $payload = self::base64Url(json_encode($claims, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
        $signed = "v1.{$payload}";

        return $signed.'.'.self::base64Url(hash_hmac('sha256', $signed, $secret, true));
    }

    private static function base64Url(string $bytes): string
    {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }

    private function signingSecret(): string
    {
        $secret = config('platform.game.ticket_secrets')[0] ?? '';
        if (strlen($secret) < 32) {
            throw new RuntimeException('GAME_TICKET_SECRETS must hold a secret of at least 32 bytes.');
        }

        return $secret;
    }
}
