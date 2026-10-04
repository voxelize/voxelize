<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Guild;
use App\Models\GuildMember;
use App\Models\Land;
use App\Models\LandMember;
use App\Models\User;
use App\Services\Land\LandService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class LandController extends Controller
{
    /** Lands in a world (and dimension), optionally only around a chunk. */
    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'world' => ['required', 'string', 'max:64'],
            'dimension' => ['nullable', 'string', 'max:16'],
            'mine' => ['nullable', 'boolean'],
        ]);
        $lands = Land::query()
            ->where('world', $data['world'])
            ->where('status', 'active')
            ->when($data['dimension'] ?? null, fn ($q, $d) => $q->where('dimension', $d))
            ->when($request->boolean('mine'), fn ($q) => $q->where(fn ($w) => $w
                ->where(fn ($own) => $own->where('owner_id', $request->user()->id)->whereNull('guild_id'))
                ->orWhereIn('guild_id', GuildMember::query()->where('user_id', $request->user()->id)->select('guild_id'))))
            ->with(['owner:id,public_id,username', 'members.user:id,public_id,username', 'guild:id,public_id,name,tag'])
            ->orderBy('id')
            ->limit(500)
            ->get();

        return response()->json(['lands' => $lands->map(fn (Land $l) => $this->present($l))]);
    }

    public function quote(Request $request, LandService $lands): JsonResponse
    {
        $data = $request->validate(['chunks' => ['required', 'integer', 'min:1', 'max:4096']]);

        return response()->json([
            'currency' => config('platform.land.currency'),
            'price' => $lands->price((int) $data['chunks']),
            'max_side_chunks' => (int) config('platform.land.max_side_chunks'),
            'max_chunks_per_player' => (int) config('platform.land.max_chunks_per_player'),
        ]);
    }

    public function store(Request $request, LandService $lands): JsonResponse
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
            'dimension' => ['required', 'string', 'max:16'],
            'min' => ['required', 'array', 'size:2'],
            'min.*' => ['required', 'integer', 'between:-1000000,1000000'],
            'max' => ['required', 'array', 'size:2'],
            'max.*' => ['required', 'integer', 'between:-1000000,1000000'],
            'name' => ['required', 'string', 'min:1', 'max:48'],
            'guild' => ['nullable', 'string', 'max:26'],
        ]);
        $guild = null;
        if (! empty($data['guild'])) {
            $guild = Guild::query()->where('public_id', $data['guild'])->where('status', 'active')->firstOr(fn () => abort(response()->json([
                'error' => ['code' => 'guild_not_found', 'message' => 'No such guild.'],
            ], 404)));
        }

        $land = $lands->claim(
            $request->user(),
            $data['world'],
            $data['dimension'],
            array_map('intval', $data['min']),
            array_map('intval', $data['max']),
            trim($data['name']),
            $key,
            $guild,
        );

        return response()->json(['land' => $this->present($land->fresh(['owner', 'members.user'])), 'replayed' => $land->wasReplayed], $land->wasReplayed ? 200 : 201);
    }

    public function update(Request $request, LandService $lands, string $land): JsonResponse
    {
        $data = $request->validate([
            'name' => ['nullable', 'string', 'min:1', 'max:48'],
            'permissions' => ['nullable', 'array'],
            'permissions.build' => ['boolean'],
            'permissions.containers' => ['boolean'],
            'permissions.use' => ['boolean'],
        ]);
        $updated = $lands->update($request->user(), $this->find($land), $data['name'] ?? null, $data['permissions'] ?? null);

        return response()->json(['land' => $this->present($updated->fresh(['owner', 'members.user']))]);
    }

    public function destroy(Request $request, LandService $lands, string $land): JsonResponse
    {
        $lands->release($request->user(), $this->find($land));

        return response()->json(['released' => true]);
    }

    public function addMember(Request $request, LandService $lands, string $land): JsonResponse
    {
        $data = $request->validate([
            'player' => ['required', 'string', 'max:24'],
            'role' => ['required', 'string', 'in:'.implode(',', Land::ROLES)],
        ]);
        $member = $this->player($data['player']);
        $lands->setMember($request->user(), $this->find($land), $member, $data['role']);

        return response()->json(['land' => $this->present($this->find($land)->load(['owner', 'members.user']))]);
    }

    public function removeMember(Request $request, LandService $lands, string $land, string $player): JsonResponse
    {
        $lands->removeMember($request->user(), $this->find($land), $this->player($player));

        return response()->json(['land' => $this->present($this->find($land)->load(['owner', 'members.user']))]);
    }

    private function find(string $publicId): Land
    {
        return Land::query()->where('public_id', $publicId)->firstOr(fn () => abort(response()->json([
            'error' => ['code' => 'land_not_found', 'message' => 'No such land.'],
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

    /** @return array<string, mixed> */
    private function present(Land $land): array
    {
        return [
            'id' => $land->public_id,
            'name' => $land->name,
            'world' => $land->world,
            'dimension' => $land->dimension,
            'min' => [$land->min_chunk_x, $land->min_chunk_z],
            'max' => [$land->max_chunk_x, $land->max_chunk_z],
            'chunks' => $land->chunkCount(),
            'owner' => ['id' => $land->owner->public_id, 'name' => $land->owner->username],
            'guild' => $land->guild ? ['id' => $land->guild->public_id, 'name' => $land->guild->name, 'tag' => $land->guild->tag] : null,
            'members' => $land->members->map(fn (LandMember $m) => [
                'id' => $m->user->public_id,
                'name' => $m->user->username,
                'role' => $m->role,
            ])->values(),
            'permissions' => array_merge(Land::DEFAULT_PERMISSIONS, (array) $land->permissions),
            'status' => $land->status,
        ];
    }
}
