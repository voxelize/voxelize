<?php

namespace App\Services\Economy;

use App\Models\LedgerAccount;

/** One side of a posting: an account and a signed amount in minor units. */
final class Leg
{
    public function __construct(
        public readonly LedgerAccount $account,
        public readonly int $amount,
    ) {}
}
