<?php

namespace App\Services\Economy;

/**
 * A request to record one balanced transaction. Built by the higher-level
 * operations in LedgerService; never constructed from client input directly.
 */
final class Posting
{
    /**
     * @param  list<Leg>  $legs
     * @param  array<string, mixed>  $metadata
     */
    public function __construct(
        public readonly string $type,
        public readonly string $reason,
        public readonly string $idempotencyKey,
        public readonly array $legs,
        public readonly ?string $referenceType = null,
        public readonly ?string $referenceId = null,
        public readonly ?int $initiatedBy = null,
        public readonly array $metadata = [],
    ) {}

    /**
     * Fingerprint of everything that defines the request, so a reused
     * idempotency key with different content is detected.
     */
    public function hash(): string
    {
        $legs = array_map(fn (Leg $leg) => [$leg->account->id, $leg->amount], $this->legs);
        usort($legs, fn ($a, $b) => [$a[0], $a[1]] <=> [$b[0], $b[1]]);

        return hash('sha256', json_encode([
            $this->type,
            $legs,
            $this->referenceType,
            $this->referenceId,
        ], JSON_THROW_ON_ERROR));
    }
}
