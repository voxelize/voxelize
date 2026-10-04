<?php

namespace App\Services\Market;

use RuntimeException;

/** A market request that cannot be honoured, with a stable error code. */
class MarketException extends RuntimeException
{
    public function __construct(
        public readonly string $errorCode,
        string $message,
        public readonly int $status = 422,
    ) {
        parent::__construct($message);
    }
}
