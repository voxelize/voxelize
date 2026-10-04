<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;

/**
 * Grants or removes a game role (moderator, admin). Roles reach game
 * servers in the next ticket the player is issued.
 */
class UserRole extends Command
{
    protected $signature = 'user:role {user : Username} {role : moderator or admin} {--remove}';

    protected $description = 'Grant or remove a game role';

    public function handle(): int
    {
        $user = User::query()->where('username', $this->argument('user'))->first();
        $role = (string) $this->argument('role');
        if (! $user) {
            $this->error('Unknown user.');

            return self::FAILURE;
        }
        if (! in_array($role, User::GRANTABLE_ROLES, true)) {
            $this->error('Role must be one of: '.implode(', ', User::GRANTABLE_ROLES).'.');

            return self::FAILURE;
        }
        $roles = array_values(array_diff((array) ($user->roles ?? []), [$role]));
        if (! $this->option('remove')) {
            $roles[] = $role;
        }
        $user->roles = $roles;
        $user->save();
        $this->info("{$user->username}: ".implode(', ', $user->gameRoles()));

        return self::SUCCESS;
    }
}
