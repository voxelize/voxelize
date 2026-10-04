<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\BlueprintDesign;
use App\Models\BlueprintLicense;
use App\Models\BlueprintProvenance;
use App\Models\BlueprintResale;
use App\Models\User;
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
        $licensed = BlueprintLicense::query()->where('user_id', $user->id)->where('status', 'active')->pluck('blueprint_id');
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
            'royalty_bps' => ['nullable', 'integer', 'min:0', 'max:5000'],
        ]);
        $design = $blueprints->update(
            $request->user(),
            $this->find($blueprint),
            $data['name'] ?? null,
            isset($data['price']) ? (int) $data['price'] : null,
            isset($data['max_copies']) ? (int) $data['max_copies'] : null,
            $request->has('published') ? $request->boolean('published') : null,
            isset($data['royalty_bps']) ? (int) $data['royalty_bps'] : null,
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

    /** Open resales of a blueprint, cheapest first. */
    public function resales(Request $request, string $blueprint): JsonResponse
    {
        $design = $this->find($blueprint);
        $rows = BlueprintResale::query()->where('blueprint_id', $design->id)->where('status', 'open')
            ->with('seller:id,public_id,username')->orderBy('price')->limit(100)->get();

        return response()->json(['resales' => $rows->map(fn (BlueprintResale $r) => $this->presentResale($r, $design))]);
    }

    public function listResale(Request $request, BlueprintService $blueprints, string $blueprint): JsonResponse
    {
        $data = $request->validate(['price' => ['required', 'integer', 'min:1']]);
        $design = $this->find($blueprint);
        $resale = $blueprints->listResale($request->user(), $design, (int) $data['price']);

        return response()->json(['resale' => $this->presentResale($resale->load('seller'), $design)], 201);
    }

    public function buyResale(Request $request, BlueprintService $blueprints, LedgerService $ledger, string $resale): JsonResponse
    {
        $row = $this->findResale($resale);
        $sold = $blueprints->buyResale($request->user(), $row);

        return response()->json([
            'resale' => $this->presentResale($sold->load('seller'), $row->design),
            'balance' => $ledger->balance($request->user(), (string) config('platform.market.currency')),
        ]);
    }

    public function cancelResale(Request $request, BlueprintService $blueprints, string $resale): JsonResponse
    {
        $blueprints->cancelResale($request->user(), $this->findResale($resale));

        return response()->json(['cancelled' => true]);
    }

    /** Every licence minted or resold, oldest first. */
    public function provenance(string $blueprint): JsonResponse
    {
        $design = $this->find($blueprint);
        $rows = BlueprintProvenance::query()->where('blueprint_id', $design->id)->orderBy('id')->limit(500)->get();
        $names = User::query()->whereIn('id', $rows->pluck('from_id')->merge($rows->pluck('to_id'))->filter()->unique())
            ->pluck('username', 'id');

        return response()->json(['provenance' => $rows->map(fn (BlueprintProvenance $p) => [
            'event' => $p->event,
            'from' => $p->from_id ? $names[$p->from_id] ?? null : null,
            'to' => $names[$p->to_id] ?? null,
            'edition' => $p->edition,
            'price' => (int) $p->price,
            'royalty' => (int) $p->royalty,
            'at' => $p->created_at?->toIso8601String(),
        ])]);
    }

    private function findResale(string $publicId): BlueprintResale
    {
        return BlueprintResale::query()->where('public_id', $publicId)->with('design.creator')->firstOr(fn () => abort(response()->json([
            'error' => ['code' => 'listing_not_found', 'message' => 'No such listing.'],
        ], 404)));
    }

    /** @return array<string, mixed> */
    private function presentResale(BlueprintResale $r, BlueprintDesign $design): array
    {
        return [
            'id' => $r->public_id,
            'blueprint' => $design->public_id,
            'name' => $design->name,
            'seller' => ['id' => $r->seller->public_id, 'name' => $r->seller->username],
            'price' => $r->price,
            'royalty_bps' => $design->royalty_bps,
            'status' => $r->status,
        ];
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
            'royalty_bps' => $d->royalty_bps,
            'mine' => $d->creator_id === $user->id,
            'licensed' => $d->mayBuild($user),
        ];
    }
}
