<?php

namespace App\Services\Moderation;

use App\Models\PlayerReport;
use App\Models\User;
use App\Services\Audit\AuditLogger;
use App\Services\Market\MarketException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Players report other players (from the game or the web); moderators
 * resolve or dismiss each report. Reports never sanction anyone by
 * themselves.
 */
class ReportService
{
    /** Reports one player may file per hour. */
    public const PER_HOUR = 5;

    /** The same reporter and target again within this many minutes is a duplicate. */
    public const DUPLICATE_MINUTES = 10;

    public function __construct(private readonly AuditLogger $audit) {}

    /** A category from free text: its first word when that names one, else `other`. */
    public static function categoryOf(string $text): array
    {
        $text = trim($text);
        [$first, $rest] = array_pad(preg_split('/\s+/', $text, 2) ?: [], 2, '');
        $first = strtolower($first);
        if (in_array($first, PlayerReport::CATEGORIES, true)) {
            return [$first, trim($rest) !== '' ? trim($rest) : $first];
        }

        return ['other', $text];
    }

    /**
     * @param  array<string, mixed>|null  $context
     */
    public function file(User $reporter, User $target, string $category, string $details, string $source, ?string $world = null, ?array $context = null): PlayerReport
    {
        if ($reporter->id === $target->id) {
            throw new MarketException('self', 'You cannot report yourself.', 422);
        }
        if ($target->status === User::STATUS_DELETED) {
            throw new MarketException('player_not_found', 'No such player.', 404);
        }
        if (! in_array($category, PlayerReport::CATEGORIES, true)) {
            throw new MarketException('bad_category', 'Unknown report category.', 422);
        }
        $details = Str::limit(trim(preg_replace('/[\x00-\x1F\x7F]/u', ' ', $details) ?? ''), 497);
        if (mb_strlen($details) < 3) {
            throw new MarketException('details_required', 'Say what happened.', 422);
        }

        return DB::transaction(function () use ($reporter, $target, $category, $details, $source, $world, $context) {
            $recent = PlayerReport::query()->where('reporter_id', $reporter->id)
                ->where('created_at', '>=', now()->subHour())->lockForUpdate()->get(['target_id', 'created_at']);
            if ($recent->contains(fn ($r) => $r->target_id === $target->id && $r->created_at->gte(now()->subMinutes(self::DUPLICATE_MINUTES)))) {
                throw new MarketException('already_reported', 'You reported this player a moment ago; a moderator will look at it.', 409);
            }
            if ($recent->count() >= self::PER_HOUR) {
                throw new MarketException('too_many_reports', 'You have sent many reports this hour; try again later.', 429);
            }
            $report = PlayerReport::create([
                'public_id' => (string) Str::ulid(),
                'reporter_id' => $reporter->id,
                'target_id' => $target->id,
                'source' => $source,
                'world' => $world,
                'category' => $category,
                'details' => $details,
                'context' => $context,
                'status' => PlayerReport::OPEN,
            ]);
            $this->audit->record('report.filed', $reporter, 'user', $target->public_id, $category, [
                'report' => $report->public_id,
                'source' => $source,
                'world' => $world,
            ]);

            return $report;
        });
    }

    /** `resolved` or `dismissed`, with a note for the record. */
    public function handle(User $moderator, PlayerReport $report, string $outcome, string $note): PlayerReport
    {
        if ($report->target_id === $moderator->id) {
            throw new MarketException('self', 'Another moderator handles reports about you.', 422);
        }
        if ($report->status !== PlayerReport::OPEN) {
            throw new MarketException('already_handled', 'This report was already handled.', 409);
        }

        return DB::transaction(function () use ($moderator, $report, $outcome, $note) {
            $report->forceFill([
                'status' => $outcome,
                'handled_by' => $moderator->id,
                'resolution' => $note,
                'handled_at' => now(),
            ])->save();
            $this->audit->record('admin.report', $moderator, 'user', $report->target->public_id, $note, [
                'report' => $report->public_id,
                'outcome' => $outcome,
            ]);

            return $report;
        });
    }

    /** A report as moderators see it. */
    public function present(PlayerReport $r): array
    {
        return [
            'id' => $r->public_id,
            'status' => $r->status,
            'source' => $r->source,
            'world' => $r->world,
            'category' => $r->category,
            'details' => $r->details,
            'context' => $r->context,
            'reporter' => ['id' => $r->reporter->public_id, 'username' => $r->reporter->username],
            'target' => ['id' => $r->target->public_id, 'username' => $r->target->username, 'status' => $r->target->status],
            'handled_by' => $r->handler?->username,
            'resolution' => $r->resolution,
            'created_at' => $r->created_at?->toIso8601String(),
            'handled_at' => $r->handled_at?->toIso8601String(),
        ];
    }
}
