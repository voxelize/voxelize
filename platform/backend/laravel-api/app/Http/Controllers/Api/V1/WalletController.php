<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\LedgerEntry;
use App\Models\LedgerTransaction;
use App\Models\User;
use App\Services\Economy\LedgerService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class WalletController extends Controller
{
    public function index(Request $request, LedgerService $ledger): JsonResponse
    {
        $ledger->walletFor($request->user(), config('platform.economy.soft_currency'));

        $wallets = $request->user()->wallets()->with('account')->orderBy('currency')->get()
            ->map(fn ($wallet) => [
                'currency' => $wallet->currency,
                'balance' => $wallet->account->balance,
            ]);

        return response()->json(['wallets' => $wallets]);
    }

    public function entries(Request $request, LedgerService $ledger, string $currency): JsonResponse
    {
        $account = $ledger->walletFor($request->user(), strtoupper($currency))->account;

        $page = LedgerEntry::query()
            ->where('account_id', $account->id)
            ->with('transaction')
            ->orderByDesc('id')
            ->cursorPaginate(50);

        return response()->json([
            'entries' => collect($page->items())->map(fn (LedgerEntry $entry) => [
                'transaction' => $entry->transaction->public_id,
                'type' => $entry->transaction->type,
                'reason' => $entry->transaction->reason,
                'amount' => $entry->amount,
                'balance_after' => $entry->balance_after,
                'at' => $entry->created_at?->toIso8601String(),
            ]),
            'next_cursor' => $page->nextCursor()?->encode(),
        ]);
    }

    public function transfer(Request $request, LedgerService $ledger): JsonResponse
    {
        $key = (string) $request->header('Idempotency-Key', '');
        if (! preg_match('/^[A-Za-z0-9_-]{8,64}$/', $key)) {
            return response()->json(['error' => [
                'code' => 'idempotency_key_required',
                'message' => 'Send an Idempotency-Key header of 8-64 URL-safe characters.',
            ]], 400);
        }

        $data = $request->validate([
            'to' => ['required', 'string', 'max:24'],
            'currency' => ['required', 'string', 'max:8'],
            // Integers only: money is never a float.
            'amount' => ['required', 'integer', 'min:1', 'max:1000000000000'],
            'memo' => ['nullable', 'string', 'max:140'],
        ]);

        $recipient = User::query()->where('username', $data['to'])->first();
        if (! $recipient || ! $recipient->isActive()) {
            return response()->json(['error' => ['code' => 'recipient_not_found', 'message' => 'No active player with that name.']], 404);
        }

        $transaction = $ledger->transfer(
            $request->user(),
            $recipient,
            strtoupper($data['currency']),
            (int) $data['amount'],
            $key,
            $data['memo'] ?? null,
        );

        return response()->json([
            'transaction' => $this->present($transaction),
            'replayed' => $transaction->wasReplayed,
            'balance' => $ledger->balance($request->user(), strtoupper($data['currency'])),
        ], $transaction->wasReplayed ? 200 : 201);
    }

    /** @return array<string, mixed> */
    private function present(LedgerTransaction $transaction): array
    {
        return [
            'id' => $transaction->public_id,
            'type' => $transaction->type,
            'reason' => $transaction->reason,
            'created_at' => $transaction->created_at?->toIso8601String(),
        ];
    }
}
