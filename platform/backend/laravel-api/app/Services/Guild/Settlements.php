<?php

namespace App\Services\Guild;

use App\Models\Guild;
use App\Models\Land;
use Illuminate\Support\Collection;

/**
 * Settlements: a guild's lands that touch each other (sharing an edge or a
 * corner, in one world and dimension) form one settlement, whose level
 * grows with its size and the guild's membership: a village, a town, a
 * city. A guild's best settlement sets how many members it may have.
 */
class Settlements
{
    public const LEVELS = ['none', 'village', 'town', 'city'];

    /**
     * @param  Collection<int, Land>  $lands  one guild's active lands
     * @return list<array{world: string, dimension: string, lands: list<string>, chunks: int, level: string, min: array{int, int}, max: array{int, int}}>
     */
    public static function of(Collection $lands, int $members): array
    {
        $lands = $lands->values();
        $parent = range(0, max(0, $lands->count() - 1));
        $find = function (int $i) use (&$parent, &$find): int {
            return $parent[$i] === $i ? $i : ($parent[$i] = $find($parent[$i]));
        };
        foreach ($lands as $i => $a) {
            foreach ($lands as $j => $b) {
                if ($j <= $i || $a->world !== $b->world || $a->dimension !== $b->dimension) {
                    continue;
                }
                $touch = $a->min_chunk_x <= $b->max_chunk_x + 1 && $b->min_chunk_x <= $a->max_chunk_x + 1
                    && $a->min_chunk_z <= $b->max_chunk_z + 1 && $b->min_chunk_z <= $a->max_chunk_z + 1;
                if ($touch) {
                    $parent[$find($i)] = $find($j);
                }
            }
        }
        $groups = [];
        foreach ($lands as $i => $land) {
            $groups[$find($i)][] = $land;
        }

        return array_values(array_map(function (array $group) use ($members) {
            $chunks = array_sum(array_map(fn (Land $l) => $l->chunkCount(), $group));

            return [
                'world' => $group[0]->world,
                'dimension' => $group[0]->dimension,
                'lands' => array_map(fn (Land $l) => $l->public_id, $group),
                'chunks' => $chunks,
                'level' => self::level($chunks, $members),
                'min' => [min(array_map(fn (Land $l) => $l->min_chunk_x, $group)), min(array_map(fn (Land $l) => $l->min_chunk_z, $group))],
                'max' => [max(array_map(fn (Land $l) => $l->max_chunk_x, $group)), max(array_map(fn (Land $l) => $l->max_chunk_z, $group))],
            ];
        }, $groups));
    }

    public static function level(int $chunks, int $members): string
    {
        $level = 'none';
        foreach ((array) config('platform.guilds.settlements') as $name => $needs) {
            if ($chunks >= $needs['chunks'] && $members >= $needs['members']) {
                $level = $name;
            }
        }

        return $level;
    }

    /** A guild's settlements, from the database. */
    public static function forGuild(Guild $guild): array
    {
        return self::of(
            Land::query()->where('guild_id', $guild->id)->where('status', 'active')->orderBy('id')->get(),
            $guild->members()->count(),
        );
    }

    /** The guild's best settlement level. */
    public static function best(array $settlements): string
    {
        $rank = array_flip(self::LEVELS);

        return array_reduce($settlements, fn (string $best, array $s) => $rank[$s['level']] > $rank[$best] ? $s['level'] : $best, 'none');
    }

    /** How many members a guild may have, given its best settlement. */
    public static function memberLimit(Guild $guild): int
    {
        $best = self::best(self::forGuild($guild));

        return (int) (config("platform.guilds.member_limits.{$best}") ?? config('platform.guilds.max_members'));
    }
}
