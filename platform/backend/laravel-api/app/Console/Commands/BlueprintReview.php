<?php

namespace App\Console\Commands;

use App\Models\BlueprintDesign;
use App\Models\User;
use App\Services\Blueprint\BlueprintService;
use Illuminate\Console\Command;

/** Approve a blueprint waiting for review, or send it back with a note. */
class BlueprintReview extends Command
{
    protected $signature = 'blueprints:review {admin : Username of the acting moderator} {blueprint? : Public id; lists the queue when absent} {--approve} {--send-back= : Why it goes back to draft}';

    protected $description = 'Work the blueprint review queue (audited)';

    public function handle(BlueprintService $blueprints): int
    {
        $admin = User::query()->where('username', $this->argument('admin'))->first();
        if (! $admin) {
            $this->error('Unknown moderator.');

            return self::FAILURE;
        }
        if (! $this->argument('blueprint')) {
            foreach (BlueprintDesign::query()->where('status', 'in_review')->orderBy('updated_at')->get() as $d) {
                $this->line("{$d->public_id}  {$d->name}  r{$d->revision}  {$d->block_count} blocks");
            }

            return self::SUCCESS;
        }
        $design = BlueprintDesign::query()->where('public_id', $this->argument('blueprint'))->first();
        $note = $this->option('send-back');
        if (! $design || ($this->option('approve') === ($note !== null))) {
            $this->error('Name a blueprint and either --approve or --send-back="reason".');

            return self::FAILURE;
        }
        $blueprints->review($admin, $design, (bool) $this->option('approve'), $note);
        $this->info("{$design->public_id}: ".($this->option('approve') ? 'published' : 'sent back'));

        return self::SUCCESS;
    }
}
