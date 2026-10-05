<?php

namespace App\Services\Social;

use App\Models\AuditLog;
use App\Models\Contract;
use App\Models\CosmeticUnlock;
use App\Models\Friendship;
use App\Models\GuildMember;
use App\Models\Land;
use App\Models\LedgerEntry;
use App\Models\MarketListing;
use App\Models\User;
use App\Models\World;
use App\Services\Audit\AuditLogger;
use App\Services\Contract\ContractService;
use App\Services\Economy\LedgerService;
use App\Services\Guild\GuildService;
use App\Services\Land\LandService;
use App\Services\Market\MarketException;
use App\Services\Market\MarketService;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * A player's own account: their data to take away, and deleting it.
 *
 * Deleting never breaks other players or the books. What would leave
 * someone else waiting must be settled first (a guild they lead with other
 * members, an auction someone bid on, a contract being worked on, a bid
 * they lead). Everything else is closed for them: open listings and
 * contracts cancelled, lands released, guild left, friends and world
 * memberships removed, their worlds archived, their game state deleted. The
 * account itself is anonymised, not removed: ledger entries and the audit
 * log keep pointing at it, with no name or address left.
 */
class AccountService
{
    public function __construct(
        private readonly LedgerService $ledger,
        private readonly MarketService $market,
        private readonly LandService $lands,
        private readonly GuildService $guilds,
        private readonly ContractService $contracts,
        private readonly AuditLogger $audit,
    ) {}

    /** Why the account cannot be deleted yet, or null. */
    public function blocker(User $user): ?MarketException
    {
        $member = GuildMember::query()->where('user_id', $user->id)->with('guild')->first();
        if ($member && $member->role === 'leader' && $member->guild->members()->count() > 1) {
            return new MarketException('leader_must_hand_over', 'Make another member leader of your guild first.', 409);
        }
        if (MarketListing::query()->where('seller_id', $user->id)->where('status', 'open')->where('bid_count', '>', 0)->exists()) {
            return new MarketException('auction_has_bids', 'An auction of yours has bids: it must run to its end.', 409);
        }
        if (MarketListing::query()->where('current_bidder_id', $user->id)->where('status', 'open')->exists()) {
            return new MarketException('leading_bid', 'You lead an auction: wait until it ends.', 409);
        }
        if (Contract::query()->where('poster_id', $user->id)->where('status', 'accepted')->exists()) {
            return new MarketException('contract_in_progress', 'A contract of yours is being worked on.', 409);
        }

        return null;
    }

    public function delete(User $user, string $password): void
    {
        if (! Hash::check($password, $user->password)) {
            throw new MarketException('wrong_password', 'That is not your password.', 422);
        }
        if ($blocker = $this->blocker($user)) {
            throw $blocker;
        }
        // Close what is open, each with its own rules (refunds, deliveries).
        MarketListing::query()->where('seller_id', $user->id)->where('status', 'open')->get()
            ->each(fn (MarketListing $l) => $this->market->cancel($user, $l));
        Contract::query()->where('poster_id', $user->id)->where('status', 'open')->get()
            ->each(fn (Contract $c) => $this->contracts->cancel($user, $c));
        Contract::query()->where('contractor_id', $user->id)->where('status', 'accepted')->get()
            ->each(fn (Contract $c) => $this->contracts->abandon($user, $c));
        Land::query()->where('owner_id', $user->id)->whereNull('guild_id')->where('status', 'active')->get()
            ->each(fn (Land $l) => $this->lands->release($user, $l));
        if ($member = GuildMember::query()->where('user_id', $user->id)->with('guild')->first()) {
            $this->guilds->leave($user, $member->guild);
        }

        DB::transaction(function () use ($user) {
            $before = $user->username;
            Friendship::query()->where('user_id', $user->id)->orWhere('friend_id', $user->id)->delete();
            DB::table('world_members')->where('user_id', $user->id)->delete();
            World::query()->where('owner_id', $user->id)->update(['status' => 'archived']);
            DB::table('land_members')->where('user_id', $user->id)->delete();
            DB::table('guild_invites')->where('user_id', $user->id)->delete();
            DB::table('player_states')->where('player', $user->public_id)->delete();
            $user->tokens()->delete();
            $user->forceFill([
                'username' => 'deleted_'.strtolower(Str::random(12)),
                'email' => "deleted-{$user->public_id}@deleted.invalid",
                'password' => Hash::make(Str::random(64)),
                'remember_token' => null,
                'email_verified_at' => null,
                'status' => User::STATUS_DELETED,
                'status_reason' => 'deleted by the player',
                'roles' => null,
                'cosmetics' => null,
                'muted_until' => null,
                'mute_reason' => null,
                'last_world' => null,
                'sanctioned_at' => now(),
            ])->save();
            $this->audit->record('account.deleted', null, 'user', $user->public_id, 'deleted by the player', ['had_name' => strlen($before)]);
        });
        Cache::forget("presence:{$user->public_id}");
    }

    /** Everything the platform keeps about a player, as one document. */
    public function export(User $user): array
    {
        $wallets = $user->wallets()->with('account')->get();

        return [
            'exported_at' => now()->toIso8601String(),
            'account' => [
                'id' => $user->public_id,
                'username' => $user->username,
                'email' => $user->email,
                'email_verified_at' => $user->email_verified_at?->toIso8601String(),
                'status' => $user->status,
                'roles' => $user->gameRoles(),
                'created_at' => $user->created_at?->toIso8601String(),
                'last_seen_at' => $user->last_seen_at?->toIso8601String(),
                'cosmetics_worn' => $user->cosmetics,
            ],
            'wallets' => $wallets->map(fn ($w) => [
                'currency' => $w->currency,
                'balance' => (int) $w->account->balance,
                'entries' => LedgerEntry::query()->where('account_id', $w->ledger_account_id)->latest('id')->limit(1000)
                    ->get(['amount', 'balance_after', 'created_at']),
            ]),
            'game' => DB::table('player_states')->where('player', $user->public_id)->get()
                ->map(fn ($r) => ['world' => $r->world, 'dimension' => $r->dimension, 'updated_at' => $r->updated_at, 'record' => json_decode((string) $r->record, true)]),
            'lands' => Land::query()->where('owner_id', $user->id)->get(['public_id', 'world', 'dimension', 'name', 'status', 'created_at']),
            'market_listings' => MarketListing::query()->where('seller_id', $user->id)->latest('id')->limit(1000)->get(),
            'contracts' => Contract::query()->where('poster_id', $user->id)->orWhere('contractor_id', $user->id)->get(),
            'guild' => GuildMember::query()->where('user_id', $user->id)->with('guild:id,public_id,name,tag')->first(),
            'friends' => Friendship::query()->where('user_id', $user->id)->orWhere('friend_id', $user->id)->with(['user:id,username', 'friend:id,username'])->get()
                ->map(fn (Friendship $f) => ['with' => $f->user_id === $user->id ? $f->friend->username : $f->user->username, 'status' => $f->status]),
            'worlds' => World::query()->where('owner_id', $user->id)->get(['public_id', 'name', 'visibility', 'realm', 'status']),
            'cosmetics_owned' => CosmeticUnlock::query()->where('user_id', $user->id)->pluck('cosmetic'),
            'history' => AuditLog::query()->where('subject_type', 'user')->where('subject_id', $user->public_id)->latest('id')->limit(500)
                ->get(['action', 'reason', 'created_at']),
        ];
    }
}
