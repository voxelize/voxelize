<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\GameTicket;
use App\Models\LedgerTransaction;
use App\Models\User;
use App\Services\Audit\AuditLogger;
use App\Services\Economy\LedgerService;
use App\Services\Game\WorldDirectory;
use App\Services\Market\MarketException;
use App\Services\Social\FriendService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * The admin panel's API. Moderators see players and sanction them;
 * administrators also manage roles and grant currency. Every change is
 * audited with the acting user and a reason.
 */
class AdminController extends Controller
{
    public function players(Request $request, FriendService $friends): JsonResponse
    {
        $data = $request->validate([
            'q' => ['nullable', 'string', 'max:64'],
            'status' => ['nullable', Rule::in([User::STATUS_ACTIVE, User::STATUS_SUSPENDED, User::STATUS_BANNED, 'muted'])],
        ]);
        $rows = User::query()
            ->when($data['q'] ?? null, fn ($q, $term) => $q->where(fn ($w) => $w->whereRaw('instr(lower(username), lower(?)) > 0', [$term])
                ->orWhereRaw('instr(lower(email), lower(?)) > 0', [$term])->orWhere('public_id', $term)))
            ->when(($data['status'] ?? null) === 'muted', fn ($q) => $q->where('muted_until', '>', now()))
            ->when(in_array($data['status'] ?? null, [User::STATUS_ACTIVE, User::STATUS_SUSPENDED, User::STATUS_BANNED], true), fn ($q) => $q->where('status', $data['status']))
            ->orderByDesc('last_seen_at')->orderBy('username')->limit(100)->get();

        return response()->json(['players' => $rows->map(fn (User $u) => $this->card($u, $friends))]);
    }

    public function player(LedgerService $ledger, FriendService $friends, string $player): JsonResponse
    {
        $user = $this->find($player);
        $wallets = $user->wallets()->with('account')->get()->map(fn ($w) => ['currency' => $w->currency, 'balance' => (int) $w->account->balance]);
        $audit = AuditLog::query()
            ->where(fn ($q) => $q->where('subject_type', 'user')->where('subject_id', $user->public_id))
            ->orWhere('actor_id', $user->id)
            ->orWhere('payload->recipient', $user->public_id)
            ->latest('id')->limit(30)->get(['action', 'reason', 'payload', 'actor_type', 'created_at']);

        return response()->json([
            'player' => [
                ...$this->card($user, $friends),
                'email' => $user->email,
                'created_at' => $user->created_at?->toIso8601String(),
                'wallets' => $wallets,
                'tickets_today' => GameTicket::query()->where('user_id', $user->id)->where('issued_at', '>=', now()->startOfDay())->count(),
            ],
            'audit' => $audit,
        ]);
    }

    /** `{ "status": active | suspended | banned, "reason" }`. Only admins ban, and nobody sanctions an admin but an admin. */
    public function status(Request $request, AuditLogger $audit, string $player): JsonResponse
    {
        $data = $request->validate([
            'status' => ['required', Rule::in([User::STATUS_ACTIVE, User::STATUS_SUSPENDED, User::STATUS_BANNED])],
            'reason' => ['required', 'string', 'min:3', 'max:255'],
        ]);
        $actor = $request->user();
        $user = $this->find($player);
        $this->mayModerate($actor, $user);
        if ($data['status'] === User::STATUS_BANNED && ! $actor->hasRole('admin')) {
            throw new MarketException('forbidden', 'Only administrators ban.', 403);
        }
        DB::transaction(function () use ($user, $data, $actor, $audit) {
            $before = $user->status;
            $user->forceFill([
                'status' => $data['status'],
                'status_reason' => $data['status'] === User::STATUS_ACTIVE ? null : $data['reason'],
                'sanctioned_at' => now(),
            ])->save();
            if ($data['status'] !== User::STATUS_ACTIVE) {
                // Signed-in sessions end too.
                $user->tokens()->delete();
            }
            $audit->record('admin.status', $actor, 'user', $user->public_id, $data['reason'], ['from' => $before, 'to' => $data['status']]);
        });

        return response()->json(['player' => $this->card($user->fresh(), app(FriendService::class))]);
    }

    /** `{ "minutes": 1..43200, "reason" }`; `minutes: 0` lifts it. */
    public function mute(Request $request, AuditLogger $audit, string $player): JsonResponse
    {
        $data = $request->validate([
            'minutes' => ['required', 'integer', 'min:0', 'max:43200'],
            'reason' => ['required', 'string', 'min:3', 'max:255'],
        ]);
        $actor = $request->user();
        $user = $this->find($player);
        $this->mayModerate($actor, $user);
        DB::transaction(function () use ($user, $data, $actor, $audit) {
            $user->forceFill([
                'muted_until' => $data['minutes'] > 0 ? now()->addMinutes($data['minutes']) : null,
                'mute_reason' => $data['minutes'] > 0 ? $data['reason'] : null,
                'sanctioned_at' => now(),
            ])->save();
            $audit->record($data['minutes'] > 0 ? 'admin.mute' : 'admin.unmute', $actor, 'user', $user->public_id, $data['reason'], ['minutes' => $data['minutes']]);
        });

        return response()->json(['player' => $this->card($user->fresh(), app(FriendService::class))]);
    }

    /** `{ "roles": ["moderator", "admin"] }` (administrators only). */
    public function roles(Request $request, AuditLogger $audit, string $player): JsonResponse
    {
        $data = $request->validate([
            'roles' => ['present', 'array'],
            'roles.*' => [Rule::in(User::GRANTABLE_ROLES)],
            'reason' => ['required', 'string', 'min:3', 'max:255'],
        ]);
        $actor = $request->user();
        $user = $this->find($player);
        if ($user->id === $actor->id && ! in_array('admin', $data['roles'], true)) {
            throw new MarketException('self', 'You cannot take your own admin role.', 422);
        }
        DB::transaction(function () use ($user, $data, $actor, $audit) {
            $before = $user->gameRoles();
            $user->forceFill(['roles' => array_values(array_unique($data['roles']))])->save();
            $audit->record('admin.roles', $actor, 'user', $user->public_id, $data['reason'], ['from' => $before, 'to' => $user->gameRoles()]);
        });

        return response()->json(['player' => $this->card($user->fresh(), app(FriendService::class))]);
    }

    /** `{ "currency", "amount", "reason" }` (administrators only): new money, audited. */
    public function grant(Request $request, LedgerService $ledger, string $player): JsonResponse
    {
        $data = $request->validate([
            'currency' => ['required', 'string', 'max:8'],
            'amount' => ['required', 'integer', 'min:1', 'max:1000000000'],
            'reason' => ['required', 'string', 'min:3', 'max:255'],
        ]);
        $user = $this->find($player);
        $key = (string) ($request->header('Idempotency-Key') ?: Str::ulid());
        $tx = $ledger->mint($user, strtoupper($data['currency']), (int) $data['amount'], $data['reason'], "admin:{$key}", $request->user(), 'admin');

        return response()->json(['transaction' => $tx->public_id, 'balance' => $ledger->balance($user, strtoupper($data['currency']))], 201);
    }

    /** Money in circulation per currency, minted and burned, the ledger's health and the latest transactions. */
    public function economy(LedgerService $ledger): JsonResponse
    {
        $currencies = DB::table('ledger_accounts')->select('currency')
            ->selectRaw("sum(case when type = 'wallet' then balance else 0 end) as wallets")
            ->selectRaw("sum(case when type = 'escrow' then balance else 0 end) as escrow")
            ->selectRaw("sum(case when code like 'guild:%' then balance else 0 end) as guilds")
            ->selectRaw("sum(case when code like 'system:mint:%' then -balance else 0 end) as minted")
            ->selectRaw("sum(case when code like 'system:burn:%' then balance else 0 end) as burned")
            ->groupBy('currency')->get()
            ->map(fn ($r) => ['currency' => $r->currency, 'wallets' => (int) $r->wallets, 'escrow' => (int) $r->escrow, 'guilds' => (int) $r->guilds, 'minted' => (int) $r->minted, 'burned' => (int) $r->burned]);
        $recent = LedgerTransaction::query()->latest('id')->limit(25)->get(['public_id', 'type', 'reason', 'created_at']);

        return response()->json(['currencies' => $currencies, 'problems' => $ledger->verify(), 'recent' => $recent]);
    }

    /** Every world with what its game servers report, and tickets issued lately. */
    public function servers(Request $request, WorldDirectory $worlds): JsonResponse
    {
        $status = DB::table('world_status')->orderBy('world')->orderBy('dimension')->get()
            ->map(fn ($r) => ['world' => $r->world, 'dimension' => $r->dimension, 'players' => (int) $r->players, 'seen_at' => $r->seen_at,
                'online' => now()->subSeconds((int) config('platform.worlds.online_seconds'))->lte($r->seen_at)]);

        return response()->json([
            'worlds' => $status,
            'online_players' => User::query()->where('last_seen_at', '>=', now()->subSeconds((int) config('platform.friends.online_seconds')))->count(),
            'tickets_last_hour' => GameTicket::query()->where('issued_at', '>=', now()->subHour())->count(),
            'accounts' => User::query()->count(),
        ]);
    }

    public function audit(Request $request): JsonResponse
    {
        $data = $request->validate(['action' => ['nullable', 'string', 'max:64'], 'limit' => ['nullable', 'integer', 'min:1', 'max:200']]);
        $rows = AuditLog::query()->when($data['action'] ?? null, fn ($q, $a) => $q->where('action', 'like', "{$a}%"))
            ->latest('id')->limit($data['limit'] ?? 50)->get();

        return response()->json(['entries' => $rows]);
    }

    private function card(User $u, FriendService $friends): array
    {
        return [
            'id' => $u->public_id,
            'username' => $u->username,
            'status' => $u->status,
            'status_reason' => $u->status_reason,
            'roles' => $u->gameRoles(),
            'muted_until' => $u->isMuted() ? $u->muted_until->toIso8601String() : null,
            'mute_reason' => $u->isMuted() ? $u->mute_reason : null,
            'online' => $friends->online($u),
            'world' => $friends->online($u) ? $u->last_world : null,
            'last_seen_at' => $u->last_seen_at?->toIso8601String(),
        ];
    }

    private function find(string $player): User
    {
        return User::query()->where('public_id', $player)->orWhere('username', $player)->first()
            ?? throw new MarketException('player_not_found', 'No such player.', 404);
    }

    private function mayModerate(User $actor, User $target): void
    {
        if ($actor->id === $target->id) {
            throw new MarketException('self', 'Not on yourself.', 422);
        }
        if ($target->hasRole('admin') && ! $actor->hasRole('admin')) {
            throw new MarketException('forbidden', 'Only administrators moderate administrators.', 403);
        }
    }
}
