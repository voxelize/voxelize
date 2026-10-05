<?php

namespace App\Http\Controllers\Internal;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\Economy\EconomyFreeze;
use App\Services\Social\FriendService;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;

/**
 * Business metrics in the Prometheus text format, for the same scraper as
 * the game servers' /platform/metrics. Service token, private network.
 */
class MetricsController extends Controller
{
    public function __invoke(): Response
    {
        $lines = [];
        $gauge = function (string $name, string $help, iterable $samples) use (&$lines) {
            $lines[] = "# HELP {$name} {$help}";
            $lines[] = "# TYPE {$name} gauge";
            foreach ($samples as [$labels, $value]) {
                $l = $labels ? '{'.implode(',', array_map(fn ($k, $v) => $k.'="'.addcslashes((string) $v, "\\\"\n").'"', array_keys($labels), $labels)).'}' : '';
                $lines[] = "{$name}{$l} ".(0 + $value);
            }
        };

        $gauge('platform_accounts', 'Accounts by status.', User::query()->select('status', DB::raw('count(*) as n'))->groupBy('status')->get()
            ->map(fn ($r) => [['status' => $r->status], $r->n]));
        $gauge('platform_players_online', 'Players the game servers reported in the last 90 s.', [[[], app(FriendService::class)->onlineCount()]]);
        $gauge('platform_world_players', 'Players per world and dimension, as last reported.', DB::table('world_status')->get()
            ->map(fn ($r) => [['world' => $r->world, 'dimension' => $r->dimension], $r->players]));
        $gauge('platform_world_report_age_seconds', 'Seconds since each world last reported.', DB::table('world_status')->get()
            ->map(fn ($r) => [['world' => $r->world, 'dimension' => $r->dimension], max(0, now()->getTimestamp() - strtotime((string) $r->seen_at))]));
        $gauge('platform_money_supply', 'Money in wallets, escrow and guild treasuries, per currency.', DB::table('ledger_accounts')
            ->whereIn('type', ['wallet', 'escrow', 'guild'])->select('currency', DB::raw('sum(balance) as total'))->groupBy('currency')->get()
            ->map(fn ($r) => [['currency' => $r->currency], $r->total]));
        $gauge('platform_market_listings', 'Market listings by status.', DB::table('market_listings')->select('status', DB::raw('count(*) as n'))->groupBy('status')->get()
            ->map(fn ($r) => [['status' => $r->status], $r->n]));
        $gauge('platform_economy_frozen', 'Whether money endpoints are frozen (the ledger did not balance).', [[[], app(EconomyFreeze::class)->state() === null ? 0 : 1]]);
        $gauge('platform_reports', 'Player reports by status.', DB::table('player_reports')->select('status', DB::raw('count(*) as n'))->groupBy('status')->get()
            ->map(fn ($r) => [['status' => $r->status], $r->n]));
        $gauge('platform_game_tickets_last_hour', 'Game tickets issued in the last hour.', [[[], DB::table('game_tickets')->where('issued_at', '>=', now()->subHour())->count()]]);
        $gauge('platform_audit_actions_last_hour', 'Audited actions in the last hour.', [[[], DB::table('audit_logs')->where('created_at', '>=', now()->subHour())->count()]]);

        return response(implode("\n", $lines)."\n", 200, ['Content-Type' => 'text/plain; version=0.0.4']);
    }
}
