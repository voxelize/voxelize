<?php

namespace App\Models\Concerns;

use LogicException;

/**
 * Rows of append-only tables are written once. Corrections are new rows
 * (for the ledger: reversing transactions), so history can always be
 * replayed and audited.
 */
trait AppendOnly
{
    public static function bootAppendOnly(): void
    {
        static::updating(function ($model) {
            throw new LogicException(static::class.' rows are append-only and cannot be updated.');
        });

        static::deleting(function ($model) {
            throw new LogicException(static::class.' rows are append-only and cannot be deleted.');
        });
    }
}
