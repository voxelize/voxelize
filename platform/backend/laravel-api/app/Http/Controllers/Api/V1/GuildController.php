<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Guild;
use App\Models\GuildInvite;
use App\Models\GuildMember;
use App\Models\GuildMessage;
use App\Models\LedgerEntry;
use App\Models\User;
use App\Services\Economy\LedgerService;
use App\Services\Guild\GuildService;
use App\Services\Guild\Settlements;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;

class GuildController extends Controller
{
    /** Active guilds, optionally matching a name or tag. */
    public function index(Request $request): JsonResponse
    {
        $data = $request->validate(['q' => ['nullable', 'string', 'max:32']]);
        $rows = Guild::query()->where('status', 'active')
            ->when($data['q'] ?? null, fn ($q, $term) => $q->where(fn ($w) => $w->where('name', 'like', "%{$term}%")->orWhere('tag', strtoupper($term))))
            ->with('leader:id,public_id,username')->withCount('members')
            ->orderBy('name')->limit(100)->get();

        return response()->json(['guilds' => $rows->map(fn (Guild $g) => $this->summary($g))]);
    }

    /** My guild (with members and treasury) and the invitations waiting for me. */
    public function mine(Request $request, LedgerService $ledger): JsonResponse
    {
        $user = $request->user();
        $member = GuildMember::query()->where('user_id', $user->id)->with('guild')->first();
        $invites = GuildInvite::query()->where('user_id', $user->id)
            ->with(['guild.leader:id,public_id,username', 'guild' => fn ($q) => $q->withCount('members')])->get()
            ->filter(fn (GuildInvite $i) => $i->guild->status === 'active');

        return response()->json([
            'guild' => $member ? $this->detail($member->guild, $ledger) : null,
            'invites' => $invites->map(fn (GuildInvite $i) => $this->summary($i->guild))->values(),
        ]);
    }

    public function show(LedgerService $ledger, string $guild): JsonResponse
    {
        return response()->json(['guild' => $this->detail($this->find($guild), $ledger)]);
    }

    public function store(Request $request, GuildService $guilds, LedgerService $ledger): JsonResponse
    {
        if ($error = $this->keyError($request)) {
            return $error;
        }
        $data = $request->validate(['name' => ['required', 'string', 'max:32'], 'tag' => ['required', 'string', 'max:5']]);
        $guild = $guilds->create($request->user(), $data['name'], $data['tag'], (string) $request->header('Idempotency-Key'));

        return response()->json([
            'guild' => $this->detail($guild->fresh(), $ledger),
            'replayed' => $guild->wasReplayed,
            'balance' => $ledger->balance($request->user(), (string) config('platform.economy.soft_currency')),
        ], $guild->wasReplayed ? 200 : 201);
    }

    public function invite(Request $request, GuildService $guilds, string $guild): JsonResponse
    {
        $data = $request->validate(['player' => ['required', 'string', 'max:24']]);
        $guilds->invite($request->user(), $this->find($guild), $this->player($data['player']));

        return response()->json(['invited' => true]);
    }

    public function join(Request $request, GuildService $guilds, LedgerService $ledger, string $guild): JsonResponse
    {
        $found = $this->find($guild);
        $guilds->join($request->user(), $found);

        return response()->json(['guild' => $this->detail($found->fresh(), $ledger)]);
    }

    /** Decline an invitation. */
    public function decline(Request $request, string $guild): JsonResponse
    {
        GuildInvite::query()->where('guild_id', $this->find($guild)->id)->where('user_id', $request->user()->id)->delete();

        return response()->json(['declined' => true]);
    }

    public function leave(Request $request, GuildService $guilds, string $guild): JsonResponse
    {
        $guilds->leave($request->user(), $this->find($guild));

        return response()->json(['left' => true]);
    }

    public function kick(Request $request, GuildService $guilds, LedgerService $ledger, string $guild, string $player): JsonResponse
    {
        $found = $this->find($guild);
        $guilds->kick($request->user(), $found, $this->player($player));

        return response()->json(['guild' => $this->detail($found->fresh(), $ledger)]);
    }

    public function role(Request $request, GuildService $guilds, LedgerService $ledger, string $guild, string $player): JsonResponse
    {
        $data = $request->validate(['role' => ['required', 'string', 'in:'.implode(',', Guild::ROLES)]]);
        $found = $this->find($guild);
        $guilds->setRole($request->user(), $found, $this->player($player), $data['role']);

        return response()->json(['guild' => $this->detail($found->fresh(), $ledger)]);
    }

    public function deposit(Request $request, GuildService $guilds, LedgerService $ledger, string $guild): JsonResponse
    {
        if ($error = $this->keyError($request)) {
            return $error;
        }
        $data = $request->validate(['amount' => ['required', 'integer']]);
        $found = $this->find($guild);
        $transaction = $guilds->deposit($request->user(), $found, (int) $data['amount'], (string) $request->header('Idempotency-Key'));

        return response()->json([
            'transaction' => $transaction->public_id,
            'treasury' => $this->treasury($found, $ledger),
            'balance' => $ledger->balance($request->user(), (string) config('platform.economy.soft_currency')),
        ]);
    }

    public function withdraw(Request $request, GuildService $guilds, LedgerService $ledger, string $guild): JsonResponse
    {
        if ($error = $this->keyError($request)) {
            return $error;
        }
        $data = $request->validate(['amount' => ['required', 'integer'], 'to' => ['nullable', 'string', 'max:24']]);
        $found = $this->find($guild);
        $to = isset($data['to']) ? $this->player($data['to']) : $request->user();
        $transaction = $guilds->withdraw($request->user(), $found, $to, (int) $data['amount'], (string) $request->header('Idempotency-Key'));

        return response()->json(['transaction' => $transaction->public_id, 'treasury' => $this->treasury($found, $ledger)]);
    }

    /** The treasury's ledger entries; members only. */
    public function entries(Request $request, LedgerService $ledger, string $guild): JsonResponse
    {
        $found = $this->find($guild);
        if ($found->roleOf($request->user()) === null) {
            return response()->json(['error' => ['code' => 'forbidden', 'message' => 'Members only.']], 403);
        }
        $account = $ledger->guildAccount($found, (string) config('platform.economy.soft_currency'));
        $page = LedgerEntry::query()->where('account_id', $account->id)->with('transaction')->orderByDesc('id')->cursorPaginate(50);

        return response()->json([
            'entries' => collect($page->items())->map(fn (LedgerEntry $entry) => [
                'transaction' => $entry->transaction->public_id,
                'type' => $entry->transaction->type,
                'reason' => $entry->transaction->reason,
                'amount' => $entry->amount,
                'balance_after' => $entry->balance_after,
                'at' => $entry->created_at?->toIso8601String(),
            ]),
            'next_cursor' => $page->nextCursor()?->encode(),
        ]);
    }

    /** Guild chat since a message id (members only), oldest first. */
    public function messages(Request $request, string $guild): JsonResponse
    {
        $data = $request->validate(['after' => ['nullable', 'integer', 'min:0']]);
        $found = $this->find($guild);
        if ($found->roleOf($request->user()) === null) {
            return response()->json(['error' => ['code' => 'forbidden', 'message' => 'Members only.']], 403);
        }
        $after = (int) ($data['after'] ?? 0);
        $rows = GuildMessage::query()->where('guild_id', $found->id)
            ->when($after > 0, fn ($q) => $q->where('id', '>', $after)->orderBy('id')->limit(100),
                // Without a cursor: the latest 50.
                fn ($q) => $q->orderByDesc('id')->limit(50))
            ->with('user:id,public_id,username')->get()->sortBy('id')->values();

        return response()->json(['messages' => $rows->map(fn (GuildMessage $m) => [
            'id' => $m->id,
            'from' => ['id' => $m->user->public_id, 'name' => $m->user->username],
            'body' => $m->body,
            'at' => $m->created_at?->toIso8601String(),
        ])]);
    }

    public function say(Request $request, GuildService $guilds, string $guild): JsonResponse
    {
        $data = $request->validate(['body' => ['required', 'string', 'max:1000']]);
        $limiter = 'guild-chat:'.$request->user()->id;
        if (RateLimiter::tooManyAttempts($limiter, (int) config('platform.guilds.chat_per_minute'))) {
            return response()->json(['error' => ['code' => 'slow_down', 'message' => 'You are sending messages too fast.']], 429);
        }
        RateLimiter::hit($limiter, 60);
        $message = $guilds->say($request->user(), $this->find($guild), $data['body']);

        return response()->json(['message' => ['id' => $message->id, 'body' => $message->body]], 201);
    }

    private function keyError(Request $request): ?JsonResponse
    {
        if (preg_match('/^[A-Za-z0-9_-]{8,64}$/', (string) $request->header('Idempotency-Key', ''))) {
            return null;
        }

        return response()->json(['error' => [
            'code' => 'idempotency_key_required',
            'message' => 'Send an Idempotency-Key header of 8-64 URL-safe characters.',
        ]], 400);
    }

    private function find(string $publicId): Guild
    {
        return Guild::query()->where('public_id', $publicId)->where('status', 'active')->firstOr(fn () => abort(response()->json([
            'error' => ['code' => 'guild_not_found', 'message' => 'No such guild.'],
        ], 404)));
    }

    private function player(string $username): User
    {
        $user = User::query()->where('username', $username)->first();
        if (! $user || ! $user->isActive()) {
            abort(response()->json(['error' => ['code' => 'player_not_found', 'message' => 'No active player with that name.']], 404));
        }

        return $user;
    }

    private function treasury(Guild $guild, LedgerService $ledger): int
    {
        return (int) $ledger->guildAccount($guild, (string) config('platform.economy.soft_currency'))->fresh()->balance;
    }

    /** @return array<string, mixed> */
    private function summary(Guild $g): array
    {
        return [
            'id' => $g->public_id,
            'name' => $g->name,
            'tag' => $g->tag,
            'leader' => ['id' => $g->leader->public_id, 'name' => $g->leader->username],
            'members' => (int) ($g->members_count ?? $g->members()->count()),
        ];
    }

    /** @return array<string, mixed> */
    private function detail(Guild $g, LedgerService $ledger): array
    {
        $g->load(['leader:id,public_id,username', 'members.user:id,public_id,username']);
        $order = array_flip(Guild::ROLES);

        return [
            ...$this->summary($g),
            'members' => $g->members->count(),
            'roster' => $g->members->sortBy(fn (GuildMember $m) => [$order[$m->role] ?? 9, $m->user->username])->map(fn (GuildMember $m) => [
                'id' => $m->user->public_id,
                'name' => $m->user->username,
                'role' => $m->role,
            ])->values(),
            'treasury' => $this->treasury($g, $ledger),
            'currency' => (string) config('platform.economy.soft_currency'),
            'max_members' => Settlements::memberLimit($g),
            'settlements' => $settlements = Settlements::forGuild($g),
            'settlement_level' => Settlements::best($settlements),
            'max_chunks' => (int) config('platform.guilds.max_chunks'),
            'my_role' => request()->user() ? $g->roleOf(request()->user()) : null,
        ];
    }
}
