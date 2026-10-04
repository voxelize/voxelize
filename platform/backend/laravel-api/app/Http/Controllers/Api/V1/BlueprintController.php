<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\BlueprintDesign;
use App\Models\BlueprintLicense;
use App\Services\Blueprint\BlueprintService;
use App\Services\Economy\LedgerService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BlueprintController extends Controller
{
    /** Published blueprints of a world, newest first. */
    public function index(Request $request): JsonResponse
    {
        $data = $request->validate(['world' => ['required', 'string', 'max:64']]);
        $designs = BlueprintDesign::query()
            ->where('world', $data['world'])->where('status', 'published')
            ->with('creator:id,public_id,username')
            ->orderByDesc('id')->limit(200)->get();

        return response()->json(['blueprints' => $designs->map(fn ($d) => $this->present($d, $request))]);
    }

    /** Blueprints I made and blueprints I may build. */
    public function mine(Request $request): JsonResponse
    {
        $user = $request->user();
        $licensed = BlueprintLicense::query()->where('user_id', $user->id)->pluck('blueprint_id');
        $designs = BlueprintDesign::query()
            ->where(fn ($q) => $q->where('creator_id', $user->id)->orWhereIn('id', $licensed))
            ->where('status', '!=', 'rejected')
            ->with('creator:id,public_id,username')
            ->orderByDesc('id')->limit(500)->get();

        return response()->json(['blueprints' => $designs->map(fn ($d) => $this->present($d, $request))]);
    }

    public function update(Request $request, BlueprintService $blueprints, string $blueprint): JsonResponse
    {
        $data = $request->validate([
            'name' => ['nullable', 'string', 'min:1', 'max:64'],
            'price' => ['nullable', 'integer', 'min:1'],
            'max_copies' => ['nullable', 'integer', 'min:1'],
            'published' => ['nullable', 'boolean'],
        ]);
        $design = $blueprints->update(
            $request->user(),
            $this->find($blueprint),
            $data['name'] ?? null,
            isset($data['price']) ? (int) $data['price'] : null,
            isset($data['max_copies']) ? (int) $data['max_copies'] : null,
            $request->has('published') ? $request->boolean('published') : null,
        );

        return response()->json(['blueprint' => $this->present($design->load('creator'), $request)]);
    }

    public function buy(Request $request, BlueprintService $blueprints, LedgerService $ledger, string $blueprint): JsonResponse
    {
        $design = $this->find($blueprint);
        $license = $blueprints->buy($request->user(), $design);

        return response()->json([
            'blueprint' => $this->present($design->fresh('creator'), $request),
            'edition' => $license->edition,
            'balance' => $ledger->balance($request->user(), (string) config('platform.market.currency')),
        ], $license->wasRecentlyCreated ? 201 : 200);
    }

    private function find(string $publicId): BlueprintDesign
    {
        return BlueprintDesign::query()->where('public_id', $publicId)->with('creator')->firstOr(fn () => abort(response()->json([
            'error' => ['code' => 'blueprint_not_found', 'message' => 'No such blueprint.'],
        ], 404)));
    }

    /** @return array<string, mixed> */
    private function present(BlueprintDesign $d, Request $request): array
    {
        $user = $request->user();

        return [
            'id' => $d->public_id,
            'name' => $d->name,
            'world' => $d->world,
            'size' => [$d->size_x, $d->size_y, $d->size_z],
            'blocks' => $d->block_count,
            'materials' => $d->materials,
            'creator' => ['id' => $d->creator->public_id, 'name' => $d->creator->username],
            'status' => $d->status,
            'price' => $d->price,
            'max_copies' => $d->max_copies,
            'copies_sold' => $d->copies_sold,
            'mine' => $d->creator_id === $user->id,
            'licensed' => $d->mayBuild($user),
        ];
    }
}
