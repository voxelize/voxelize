<?php

namespace App\Services\Social;

use App\Models\CosmeticUnlock;
use App\Models\User;
use App\Services\Economy\LedgerService;
use App\Services\Market\MarketException;
use Illuminate\Support\Facades\DB;

/**
 * Cosmetics: bought once with Crowns (burned: they leave the economy), then
 * worn, one per slot. What a player wears travels in their game tickets.
 */
class CosmeticService
{
    public const SLOTS = ['outfit', 'hat'];

    public function __construct(private readonly LedgerService $ledger) {}

    /** @return array<string, array{name: string, slot: string, price: int, look: array}> */
    public function catalog(): array
    {
        return (array) config('platform.cosmetics.catalog');
    }

    /** @return list<string> keys the player owns */
    public function owned(User $user): array
    {
        return CosmeticUnlock::query()->where('user_id', $user->id)->pluck('cosmetic')->all();
    }

    /** @return array<string, string> slot => key, only what is still sold */
    public function equipped(User $user): array
    {
        $catalog = $this->catalog();

        return array_filter(
            (array) ($user->cosmetics ?? []),
            fn ($key, $slot) => isset($catalog[$key]) && $catalog[$key]['slot'] === $slot,
            ARRAY_FILTER_USE_BOTH,
        );
    }

    /** What the player wears, as game servers receive it, or null for nothing. */
    public function look(User $user): ?array
    {
        $catalog = $this->catalog();
        $look = [];
        foreach ($this->equipped($user) as $slot => $key) {
            $look[$slot] = $catalog[$key]['look'];
        }

        return $look ?: null;
    }

    public function buy(User $user, string $key): CosmeticUnlock
    {
        $item = $this->catalog()[$key] ?? throw new MarketException('unknown_cosmetic', 'No such cosmetic.', 404);

        return DB::transaction(function () use ($user, $key, $item) {
            User::query()->whereKey($user->id)->lockForUpdate()->first();
            if ($owned = CosmeticUnlock::query()->where('user_id', $user->id)->where('cosmetic', $key)->first()) {
                return $owned;
            }
            $price = (int) $item['price'];
            $tx = $price > 0
                ? $this->ledger->burn($user, (string) config('platform.cosmetics.currency'), $price, "Cosmetic: {$item['name']}", "cosmetic:{$key}")
                : null;

            return CosmeticUnlock::query()->create([
                'user_id' => $user->id,
                'cosmetic' => $key,
                'price' => $price,
                'ledger_transaction_id' => $tx?->id,
                'created_at' => now(),
            ]);
        });
    }

    /** Wear an owned cosmetic in its slot, or take the slot off (`$key` null). */
    public function equip(User $user, string $slot, ?string $key): void
    {
        if (! in_array($slot, self::SLOTS, true)) {
            throw new MarketException('bad_slot', 'No such slot.');
        }
        $worn = $this->equipped($user);
        if ($key === null) {
            unset($worn[$slot]);
        } else {
            $item = $this->catalog()[$key] ?? throw new MarketException('unknown_cosmetic', 'No such cosmetic.', 404);
            if ($item['slot'] !== $slot) {
                throw new MarketException('bad_slot', 'That is not worn there.');
            }
            if (! in_array($key, $this->owned($user), true)) {
                throw new MarketException('not_owned', 'Buy it first.', 403);
            }
            $worn[$slot] = $key;
        }
        $user->forceFill(['cosmetics' => $worn ?: null])->save();
    }
}
