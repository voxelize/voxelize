<?php

namespace App\Services\Blueprint;

use App\Models\BlueprintDesign;
use App\Models\BlueprintLicense;
use App\Models\User;
use App\Services\Audit\AuditLogger;
use App\Services\Economy\LedgerService;
use App\Services\Economy\Leg;
use App\Services\Economy\Posting;
use App\Services\Market\MarketException;
use App\Services\Market\MarketService;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Capture, publish, sell and hand out blueprints. A layout is
 * `{ "format": 1, "size": [x, y, z], "palette": [raw block…], "runs": [[i, n]…] }`:
 * palette entries are `{ "block": key, "raw": bits }` and runs walk the box
 * x-major, then y, then z.
 */
class BlueprintService
{
    public function __construct(
        private readonly LedgerService $ledger,
        private readonly MarketService $market,
        private readonly AuditLogger $audit,
    ) {}

    /**
     * Store a captured layout. `$key` comes from the game server: a retry
     * stores nothing new.
     *
     * @param  array{0: int, 1: int, 2: int}  $size
     * @param  list<array{block: ?string, raw: int}>  $palette
     * @param  list<array{0: int, 1: int}>  $runs
     * @param  array<string, int>  $materials
     */
    public function store(User $creator, string $world, string $name, array $size, array $palette, array $runs, array $materials, string $key): BlueprintDesign
    {
        if ($existing = BlueprintDesign::query()->where('upload_key', $key)->first()) {
            if ($existing->creator_id !== $creator->id) {
                throw new MarketException('key_conflict', 'That key belongs to another blueprint.', 409);
            }
            $existing->wasReplayed = true;

            return $existing;
        }
        $max = (int) config('platform.blueprints.max_side');
        foreach ($size as $side) {
            if (! is_int($side) || $side < 1 || $side > $max) {
                throw new MarketException('bad_blueprint', "A blueprint is 1 to {$max} blocks along each side.");
            }
        }
        if ($palette === [] || count($palette) > 4096) {
            throw new MarketException('bad_blueprint', 'A blueprint needs a palette of 1-4096 entries.');
        }
        foreach ($palette as $entry) {
            $block = $entry['block'] ?? null;
            if (($block !== null && ! preg_match('/^[a-z0-9_]{1,64}$/', (string) $block)) || ! is_int($entry['raw'] ?? null)) {
                throw new MarketException('bad_blueprint', 'Palette entries name a block key and its raw bits.');
            }
        }
        $cells = 0;
        $blocks = 0;
        foreach ($runs as $run) {
            [$index, $count] = [$run[0] ?? null, $run[1] ?? null];
            if (! is_int($index) || ! is_int($count) || $count < 1 || ! isset($palette[$index])) {
                throw new MarketException('bad_blueprint', 'Runs are [palette index, count] pairs.');
            }
            $cells += $count;
            if ($palette[$index]['block'] !== null) {
                $blocks += $count;
            }
        }
        if ($cells !== $size[0] * $size[1] * $size[2]) {
            throw new MarketException('bad_blueprint', 'The runs do not fill the box.');
        }
        if ($blocks === 0) {
            throw new MarketException('bad_blueprint', 'That box is empty.');
        }
        foreach ($materials as $item => $count) {
            if (! preg_match('/^[a-z0-9_]{1,64}$/', (string) $item) || ! is_int($count) || $count < 1) {
                throw new MarketException('bad_blueprint', 'Materials are item keys with counts.');
            }
        }

        $publicId = (string) Str::ulid();
        $body = json_encode(['format' => 1, 'size' => $size, 'palette' => $palette, 'runs' => $runs], JSON_THROW_ON_ERROR);
        $disk = (string) config('platform.blueprints.disk');
        $path = "blueprints/{$publicId}/v1.json";
        if (! Storage::disk($disk)->put($path, $body)) {
            throw new MarketException('storage_unavailable', 'The blueprint could not be stored; try again.', 503);
        }

        try {
            $design = BlueprintDesign::query()->create([
                'public_id' => $publicId,
                'creator_id' => $creator->id,
                'world' => $world,
                'name' => mb_substr($name, 0, 64),
                'size_x' => $size[0],
                'size_y' => $size[1],
                'size_z' => $size[2],
                'block_count' => $blocks,
                'materials' => $materials,
                'storage_disk' => $disk,
                'storage_path' => $path,
                'sha256' => hash('sha256', $body),
                'bytes' => strlen($body),
                'status' => 'draft',
                'upload_key' => $key,
            ]);
        } catch (QueryException $e) {
            Storage::disk($disk)->delete($path);
            if ($existing = BlueprintDesign::query()->where('upload_key', $key)->first()) {
                $existing->wasReplayed = true;

                return $existing;
            }
            throw $e;
        }
        $this->audit->record(
            action: 'blueprint.capture',
            actor: $creator,
            subjectType: 'blueprint',
            subjectId: $publicId,
            payload: ['size' => $size, 'blocks' => $blocks, 'sha256' => $design->sha256],
            actorType: 'game_server',
        );

        return $design;
    }

    /** The stored layout, checked against its recorded hash. */
    public function layout(BlueprintDesign $design): array
    {
        $body = Storage::disk($design->storage_disk)->get($design->storage_path);
        if ($body === null || ! hash_equals($design->sha256, hash('sha256', $body))) {
            throw new MarketException('storage_unavailable', 'The blueprint layout is missing or damaged.', 503);
        }

        return json_decode($body, true, 512, JSON_THROW_ON_ERROR);
    }

    /** Rename, price, limit and publish or unpublish (creator only). */
    public function update(User $actor, BlueprintDesign $design, ?string $name, ?int $price, ?int $maxCopies, ?bool $published): BlueprintDesign
    {
        return DB::transaction(function () use ($actor, $design, $name, $price, $maxCopies, $published) {
            $design = BlueprintDesign::query()->lockForUpdate()->findOrFail($design->id);
            if ($design->creator_id !== $actor->id) {
                throw new MarketException('forbidden', 'That is not your blueprint.', 403);
            }
            if ($design->status === 'rejected') {
                throw new MarketException('rejected', 'This blueprint was removed by moderation.', 409);
            }
            if ($name !== null) {
                $design->name = mb_substr($name, 0, 64);
            }
            if ($price !== null) {
                if ($price < 1 || $price > (int) config('platform.blueprints.max_price')) {
                    throw new MarketException('bad_price', 'Prices are whole amounts from 1.');
                }
                $design->price = $price;
            }
            if ($maxCopies !== null) {
                if ($maxCopies < max(1, $design->copies_sold)) {
                    throw new MarketException('bad_limit', 'The limit cannot be below the copies already sold.');
                }
                $design->max_copies = $maxCopies;
            }
            if ($published !== null) {
                if ($published && $design->price === null) {
                    throw new MarketException('bad_price', 'Set a price before publishing.');
                }
                $design->status = $published ? 'published' : 'draft';
            }
            $design->version += 1;
            $design->save();

            return $design;
        });
    }

    /** Buy a licence: one ledger sale pays the creator and the fee. */
    public function buy(User $buyer, BlueprintDesign $design): BlueprintLicense
    {
        return DB::transaction(function () use ($buyer, $design) {
            $design = BlueprintDesign::query()->lockForUpdate()->findOrFail($design->id);
            if ($existing = BlueprintLicense::query()->where('blueprint_id', $design->id)->where('user_id', $buyer->id)->first()) {
                return $existing;
            }
            if ($design->status !== 'published') {
                throw new MarketException('not_for_sale', 'That blueprint is not for sale.', 409);
            }
            if ($design->creator_id === $buyer->id) {
                throw new MarketException('own_listing', 'You already own your blueprint.');
            }
            if ($design->max_copies !== null && $design->copies_sold >= $design->max_copies) {
                throw new MarketException('sold_out', 'Every copy of this edition is sold.', 409);
            }
            $currency = (string) config('platform.market.currency');
            $price = (int) $design->price;
            $fee = $this->market->fee($price);
            $legs = [
                new Leg($this->ledger->walletFor($buyer, $currency)->account, -$price),
                new Leg($this->ledger->walletFor($design->creator, $currency)->account, $price - $fee),
            ];
            if ($fee > 0) {
                $legs[] = new Leg($this->ledger->systemAccount('fees', $currency), $fee);
            }
            $sale = $this->ledger->post(new Posting(
                type: 'sale',
                reason: "Blueprint licence: {$design->name}",
                idempotencyKey: "blueprint:{$design->public_id}:{$buyer->public_id}",
                legs: $legs,
                referenceType: 'blueprint',
                referenceId: $design->public_id,
                initiatedBy: $buyer->id,
            ));
            $design->copies_sold += 1;
            $design->save();
            $license = BlueprintLicense::query()->create([
                'blueprint_id' => $design->id,
                'user_id' => $buyer->id,
                'edition' => $design->max_copies !== null ? $design->copies_sold : null,
                'ledger_transaction_id' => $sale->id,
                'created_at' => now(),
            ]);
            $this->audit->record(
                action: 'blueprint.sale',
                actor: $buyer,
                subjectType: 'blueprint',
                subjectId: $design->public_id,
                payload: ['price' => $price, 'fee' => $fee, 'edition' => $license->edition, 'transaction' => $sale->public_id],
            );

            return $license;
        });
    }

    /** Moderation: take a blueprint off sale and out of use. */
    public function reject(User $moderator, BlueprintDesign $design, string $reason): BlueprintDesign
    {
        $design->status = 'rejected';
        $design->version += 1;
        $design->save();
        $this->audit->record(
            action: 'blueprint.reject',
            actor: $moderator,
            subjectType: 'blueprint',
            subjectId: $design->public_id,
            reason: $reason,
            actorType: 'admin',
        );

        return $design;
    }
}
