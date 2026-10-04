<?php

namespace App\Http\Controllers\Internal;

use App\Http\Controllers\Controller;
use App\Models\Guild;
use App\Models\GuildMember;
use App\Models\GuildRelation;
use App\Models\User;
use App\Services\Guild\DiplomacyService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * Guilds for game servers: who is in which guild, its allies and the guilds
 * it is fighting right now (players of guilds at war may fight each other).
 * Polled like the land feed; an unchanged feed answers 304.
 */
class GuildFeedController extends Controller
{
    public function __invoke(Request $request, DiplomacyService $diplomacy): Response
    {
        $diplomacy->expire();
        $guilds = Guild::query()->where('status', 'active')->with('members.user:id,public_id')->orderBy('id')->get();
        $ids = $guilds->pluck('public_id', 'id');
        $allies = [];
        $wars = [];
        foreach (GuildRelation::query()->where('status', 'active')->get() as $r) {
            if ($r->kind === 'alliance') {
                $allies[$r->guild_a_id][] = $ids[$r->guild_b_id] ?? null;
                $allies[$r->guild_b_id][] = $ids[$r->guild_a_id] ?? null;
            } elseif ($r->fighting()) {
                $wars[$r->guild_a_id][] = $ids[$r->guild_b_id] ?? null;
                $wars[$r->guild_b_id][] = $ids[$r->guild_a_id] ?? null;
            }
        }
        $body = json_encode(['guilds' => $guilds->map(fn (Guild $g) => [
            'id' => $g->public_id,
            'tag' => $g->tag,
            'name' => $g->name,
            'members' => $g->members->map(fn (GuildMember $m) => $m->user->public_id)->values()->all(),
            'allies' => array_values(array_filter($allies[$g->id] ?? [])),
            'wars' => array_values(array_filter($wars[$g->id] ?? [])),
        ])->values()->all()], JSON_THROW_ON_ERROR);
        $etag = '"'.hash('sha256', $body).'"';
        if ($request->header('If-None-Match') === $etag) {
            return response('', 304)->header('ETag', $etag);
        }

        return response($body, 200)
            ->header('Content-Type', 'application/json')
            ->header('Content-Length', (string) strlen($body))
            ->header('ETag', $etag);
    }

    /** A player killed another: counts for a war their guilds are fighting. */
    public function kill(Request $request, DiplomacyService $diplomacy): JsonResponse
    {
        $data = $request->validate([
            'key' => ['required', 'string', 'regex:/^[A-Za-z0-9_-]{8,100}$/'],
            'killer' => ['required', 'string', 'max:64'],
            'victim' => ['required', 'string', 'max:64'],
        ]);
        $killer = User::query()->where('public_id', $data['killer'])->first();
        $victim = User::query()->where('public_id', $data['victim'])->first();
        if (! $killer || ! $victim) {
            return response()->json(['error' => ['code' => 'player_not_found', 'message' => 'Unknown player.']], 404);
        }
        $relation = $diplomacy->recordKill($killer, $victim, $data['key']);
        if (! $relation) {
            return response()->json(['error' => ['code' => 'not_at_war', 'message' => 'Their guilds are not at war.']], 409);
        }

        return response()->json(['war' => $relation->public_id, 'score' => [$relation->score_a, $relation->score_b]]);
    }
}
