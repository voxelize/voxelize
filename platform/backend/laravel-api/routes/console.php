<?php

use Illuminate\Support\Facades\Schedule;

// The books must always balance; a violation exits non-zero and is logged
// by the scheduler (docs/ECONOMY_LEDGER.md §5).
Schedule::command('ledger:verify')->hourly()->withoutOverlapping();

// Auctions end and unsold listings expire on time (docs/API.md "Market").
Schedule::command('market:settle')->everyMinute()->withoutOverlapping();
