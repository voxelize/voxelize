<?php

namespace Tests\Concurrency;

use App\Models\LedgerTransaction;
use App\Models\User;
use App\Services\Economy\LedgerService;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Real concurrency: several OS processes post transfers over the same three
 * wallets at once. Row locks must keep every balance exact, no wallet may go
 * negative, and a shared idempotency key must pay exactly once.
 *
 * Needs a database other processes can see (MySQL); skipped on SQLite.
 */
class LedgerConcurrencyTest extends TestCase
{
    public function test_parallel_transfers_keep_the_books_exact(): void
    {
        if (DB::getDriverName() !== 'mysql') {
            $this->markTestSkipped('Concurrency tests need MySQL (set DB_CONNECTION=mysql).');
        }

        Artisan::call('migrate:fresh', ['--force' => true]);
        $ledger = app(LedgerService::class);
        $admin = User::factory()->create(['username' => 'race_admin']);
        foreach (['race_a', 'race_b', 'race_c'] as $name) {
            $ledger->mint(User::factory()->create(['username' => $name]), 'CRN', 100, 'race funding', "race-{$name}", $admin);
        }

        $workers = 6;
        $perWorker = 40;
        $processes = [];
        $env = array_merge(getenv(), $_ENV, ['APP_ENV' => 'testing']);
        for ($w = 0; $w < $workers; $w++) {
            $processes[] = proc_open(
                [PHP_BINARY, __DIR__.'/transfer_worker.php', (string) $w, (string) $perWorker],
                [1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
                $pipes,
                base_path(),
                $env,
            );
            $outputs[] = $pipes;
        }
        $totals = ['ok' => 0, 'replayed' => 0, 'insufficient' => 0];
        foreach ($processes as $i => $process) {
            $stdout = stream_get_contents($outputs[$i][1]);
            $stderr = stream_get_contents($outputs[$i][2]);
            $this->assertSame(0, proc_close($process), "worker {$i} failed: {$stderr}");
            foreach (json_decode(trim($stdout), true, flags: JSON_THROW_ON_ERROR) as $k => $v) {
                $totals[$k] += $v;
            }
        }

        $this->assertSame([], $ledger->verify());
        $balances = collect(['race_a', 'race_b', 'race_c'])
            ->map(fn ($n) => $ledger->balance(User::where('username', $n)->sole(), 'CRN'));
        $this->assertSame(300, $balances->sum(), 'value was created or destroyed');
        $this->assertTrue($balances->every(fn ($b) => $b >= 0), 'a wallet went negative');

        // Each shared key was paid at most once across all workers.
        $sharedPaid = LedgerTransaction::where('idempotency_key', 'like', 'transfer:%:shared-%')->count();
        $this->assertLessThanOrEqual(3 * (int) ceil($perWorker / 4), $sharedPaid);
        $this->assertSame(
            LedgerTransaction::where('type', 'transfer')->count(),
            $totals['ok'],
            'every newly created transfer is accounted for exactly once',
        );

        Artisan::call('migrate:fresh', ['--force' => true]);
    }
}
