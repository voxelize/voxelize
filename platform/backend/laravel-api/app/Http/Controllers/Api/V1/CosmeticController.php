<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\Economy\LedgerService;
use App\Services\Social\CosmeticService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CosmeticController extends Controller
{
    /** The catalog with what I own and wear. */
    public function index(Request $request, CosmeticService $cosmetics): JsonResponse
    {
        return response()->json($this->state($request, $cosmetics));
    }

    public function buy(Request $request, CosmeticService $cosmetics, LedgerService $ledger, string $cosmetic): JsonResponse
    {
        $unlock = $cosmetics->buy($request->user(), $cosmetic);

        return response()->json([
            ...$this->state($request, $cosmetics),
            'balance' => $ledger->balance($request->user(), (string) config('platform.cosmetics.currency')),
        ], $unlock->wasRecentlyCreated ? 201 : 200);
    }

    /** `{ "slot", "cosmetic": key | null }`. */
    public function equip(Request $request, CosmeticService $cosmetics): JsonResponse
    {
        $data = $request->validate([
            'slot' => ['required', 'string', 'max:16'],
            'cosmetic' => ['present', 'nullable', 'string', 'max:64'],
        ]);
        $cosmetics->equip($request->user(), $data['slot'], $data['cosmetic']);

        return response()->json($this->state($request, $cosmetics));
    }

    private function state(Request $request, CosmeticService $cosmetics): array
    {
        $user = $request->user()->fresh();
        $catalog = collect($cosmetics->catalog())->map(fn ($c, $key) => ['key' => $key, ...$c])->values();

        return [
            'catalog' => $catalog,
            'owned' => $cosmetics->owned($user),
            'equipped' => (object) $cosmetics->equipped($user),
            'look' => $cosmetics->look($user),
            'currency' => (string) config('platform.cosmetics.currency'),
        ];
    }
}
