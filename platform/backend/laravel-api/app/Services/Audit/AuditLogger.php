<?php

namespace App\Services\Audit;

use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Support\Facades\Request;

class AuditLogger
{
    /**
     * Record a sensitive action. Call it inside the database transaction of
     * the action itself, so the two commit or roll back together.
     *
     * @param  array<string, mixed>  $payload
     */
    public function record(
        string $action,
        ?User $actor,
        ?string $subjectType = null,
        string|int|null $subjectId = null,
        ?string $reason = null,
        array $payload = [],
        string $actorType = 'user',
    ): AuditLog {
        return AuditLog::create([
            'actor_id' => $actor?->id,
            'actor_type' => $actor ? $actorType : 'system',
            'action' => $action,
            'subject_type' => $subjectType,
            'subject_id' => $subjectId === null ? null : (string) $subjectId,
            'reason' => $reason,
            'payload' => $payload ?: null,
            'ip_address' => Request::ip(),
        ]);
    }
}
