<?php

namespace App\Services\Economy;

use RuntimeException;

/**
 * A ledger request that cannot be honoured. `code()` is a stable machine
 * code the API returns and clients branch on.
 */
class EconomyException extends RuntimeException
{
    public function __construct(
        public readonly string $errorCode,
        string $message,
        public readonly int $status = 422,
    ) {
        parent::__construct($message);
    }

    public static function insufficientFunds(): self
    {
        return new self('insufficient_funds', 'The account balance is too low for this transfer.');
    }

    public static function idempotencyConflict(): self
    {
        return new self('idempotency_conflict', 'This idempotency key was already used for a different request.', 409);
    }

    public static function invalid(string $message): self
    {
        return new self('invalid_posting', $message);
    }
}
