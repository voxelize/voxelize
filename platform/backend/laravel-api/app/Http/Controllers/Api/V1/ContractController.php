<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Contract;
use App\Models\Guild;
use App\Models\GuildMember;
use App\Services\Contract\ContractService;
use App\Services\Economy\LedgerService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ContractController extends Controller
{
    /** Open contracts of a world (or, with mine=1, those I posted or took). */
    public function index(Request $request): JsonResponse
    {
        $data = $request->validate(['world' => ['required', 'string', 'max:64'], 'mine' => ['nullable', 'boolean']]);
        $me = $request->user()->id;
        $myGuild = GuildMember::query()->where('user_id', $me)->value('guild_id');
        $rows = Contract::query()
            ->where('world', $data['world'])
            ->when($request->boolean('mine'),
                fn ($q) => $q->where(fn ($w) => $w->where('poster_id', $me)->orWhere('contractor_id', $me)
                    ->when($myGuild, fn ($g) => $g->orWhere('guild_id', $myGuild))),
                fn ($q) => $q->where('status', 'open')->where('deadline_at', '>', now()))
            ->with(['poster:id,public_id,username', 'contractor:id,public_id,username', 'guild:id,public_id,name,tag'])
            ->orderByDesc('id')->limit(200)->get();

        return response()->json(['contracts' => $rows->map(fn (Contract $c) => $this->present($c))]);
    }

    public function store(Request $request, ContractService $contracts, LedgerService $ledger): JsonResponse
    {
        $key = (string) $request->header('Idempotency-Key', '');
        if (! preg_match('/^[A-Za-z0-9_-]{8,64}$/', $key)) {
            return response()->json(['error' => [
                'code' => 'idempotency_key_required',
                'message' => 'Send an Idempotency-Key header of 8-64 URL-safe characters.',
            ]], 400);
        }
        $data = $request->validate([
            'world' => ['required', 'string', 'max:64'],
            'title' => ['nullable', 'string', 'max:80'],
            'item' => ['required', 'string', 'max:64'],
            'count' => ['required', 'integer'],
            'reward' => ['required', 'integer'],
            'hours' => ['nullable', 'integer'],
            'guild' => ['nullable', 'string', 'max:26'],
        ]);
        $guild = null;
        if (! empty($data['guild'])) {
            $guild = Guild::query()->where('public_id', $data['guild'])->where('status', 'active')->firstOr(fn () => abort(response()->json([
                'error' => ['code' => 'guild_not_found', 'message' => 'No such guild.'],
            ], 404)));
        }
        $contract = $contracts->post($request->user(), $data['world'], (string) ($data['title'] ?? ''), $data['item'], (int) $data['count'], (int) $data['reward'], (int) ($data['hours'] ?? 48), $key, $guild);

        return response()->json([
            'contract' => $this->present($contract->load('poster')),
            'replayed' => $contract->wasReplayed,
            'balance' => $ledger->balance($request->user(), $contract->currency),
            'treasury' => $guild ? (int) $ledger->guildAccount($guild, $contract->currency)->fresh()->balance : null,
        ], $contract->wasReplayed ? 200 : 201);
    }

    public function accept(Request $request, ContractService $contracts, string $contract): JsonResponse
    {
        return response()->json(['contract' => $this->present($contracts->accept($request->user(), $this->find($contract))->load('poster', 'contractor'))]);
    }

    public function abandon(Request $request, ContractService $contracts, string $contract): JsonResponse
    {
        return response()->json(['contract' => $this->present($contracts->abandon($request->user(), $this->find($contract))->load('poster', 'contractor'))]);
    }

    public function destroy(Request $request, ContractService $contracts, string $contract): JsonResponse
    {
        $contracts->cancel($request->user(), $this->find($contract));

        return response()->json(['cancelled' => true]);
    }

    private function find(string $publicId): Contract
    {
        return Contract::query()->where('public_id', $publicId)->with('poster')->firstOr(fn () => abort(response()->json([
            'error' => ['code' => 'contract_not_found', 'message' => 'No such contract.'],
        ], 404)));
    }

    /** @return array<string, mixed> */
    private function present(Contract $c): array
    {
        return [
            'id' => $c->public_id,
            'title' => $c->title,
            'world' => $c->world,
            'item' => $c->item,
            'count' => $c->count,
            'reward' => $c->reward,
            'currency' => $c->currency,
            'status' => $c->status,
            'poster' => ['id' => $c->poster->public_id, 'name' => $c->poster->username],
            'guild' => $c->guild ? ['id' => $c->guild->public_id, 'name' => $c->guild->name, 'tag' => $c->guild->tag] : null,
            'contractor' => $c->contractor ? ['id' => $c->contractor->public_id, 'name' => $c->contractor->username] : null,
            'deadline_at' => $c->deadline_at->toIso8601String(),
            // The viewer's part in it.
            'role' => match (request()->user()?->id) {
                $c->poster_id => 'poster',
                $c->contractor_id => 'contractor',
                default => null,
            },
        ];
    }
}
