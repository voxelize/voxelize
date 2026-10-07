<?php

namespace App\Console\Commands;

use App\Models\BlueprintDesign;
use App\Models\User;
use App\Services\Blueprint\BlueprintService;
use Illuminate\Console\Command;

class BlueprintReject extends Command
{
    protected $signature = 'blueprints:reject {admin : Username of the acting moderator} {blueprint : Public id} {--reason=}';

    protected $description = 'Take a blueprint off sale and out of use (audited)';

    public function handle(BlueprintService $blueprints): int
    {
        $admin = User::query()->where('username', $this->argument('admin'))->first();
        $design = BlueprintDesign::query()->where('public_id', $this->argument('blueprint'))->first();
        $reason = trim((string) $this->option('reason'));
        if (! $admin || ! $design || $reason === '') {
            $this->error('Name a moderator, a blueprint and a --reason.');

            return self::FAILURE;
        }
        $blueprints->reject($admin, $design, $reason);
        $this->info("Rejected {$design->public_id}.");

        return self::SUCCESS;
    }
}
