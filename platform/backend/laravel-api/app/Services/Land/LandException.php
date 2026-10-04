<?php

namespace App\Services\Land;

use RuntimeException;

/** A land request that cannot be honoured, with a stable error code. */
class LandException extends RuntimeException
{
    public function __construct(
        public readonly string $errorCode,
        string $message,
        public readonly int $status = 422,
    ) {
        parent::__construct($message);
    }
}
