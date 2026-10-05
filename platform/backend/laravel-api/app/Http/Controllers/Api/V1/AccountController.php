<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\Audit\AuditLogger;
use App\Services\Social\AccountService;
use Illuminate\Auth\Events\PasswordReset;
use Illuminate\Auth\Events\Verified;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Password as Passwords;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password;

class AccountController extends Controller
{
    /** Send a reset link. Always the same answer, so nobody learns which addresses have accounts. */
    public function forgot(Request $request): JsonResponse
    {
        $data = $request->validate(['email' => ['required', 'string', 'email', 'max:255']]);
        $user = User::query()->where('email', $data['email'])->first();
        if ($user && $user->isActive()) {
            Passwords::broker()->sendResetLink(['email' => $data['email']]);
        }

        return response()->json(['sent' => true], 202);
    }

    public function reset(Request $request, AuditLogger $audit): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'string', 'email', 'max:255'],
            'token' => ['required', 'string', 'max:255'],
            'password' => ['required', 'string', Password::min(10)],
        ]);
        $status = Passwords::broker()->reset($data, function (User $user, string $password) use ($audit) {
            $user->forceFill(['password' => $password, 'remember_token' => Str::random(60)])->save();
            // Every signed-in session ends: whoever knew the old password is out.
            $user->tokens()->delete();
            $audit->record('account.password_reset', $user, 'user', $user->public_id);
            event(new PasswordReset($user));
        });
        if ($status !== Passwords::PASSWORD_RESET) {
            return response()->json(['error' => ['code' => 'invalid_reset', 'message' => 'That reset link is not valid any more: ask for a new one.']], 422);
        }

        return response()->json(['reset' => true]);
    }

    /** Change the password while signed in; other sessions end. */
    public function changePassword(Request $request, AuditLogger $audit): JsonResponse
    {
        $data = $request->validate([
            'current' => ['required', 'string'],
            'password' => ['required', 'string', Password::min(10)],
        ]);
        $user = $request->user();
        if (! Hash::check($data['current'], $user->password)) {
            return response()->json(['error' => ['code' => 'wrong_password', 'message' => 'That is not your current password.']], 422);
        }
        $user->forceFill(['password' => $data['password']])->save();
        $current = $user->currentAccessToken();
        $user->tokens()->when($current, fn ($q) => $q->whereKeyNot($current->id))->delete();
        $audit->record('account.password_changed', $user, 'user', $user->public_id);

        return response()->json(['changed' => true]);
    }

    public function resendVerification(Request $request): JsonResponse
    {
        $user = $request->user();
        if ($user->hasVerifiedEmail()) {
            return response()->json(['verified' => true]);
        }
        $user->sendEmailVerificationNotification();

        return response()->json(['sent' => true], 202);
    }

    /** The signed link from the email: confirm, then open the web client. */
    public function verify(Request $request, string $id, string $hash): RedirectResponse
    {
        $user = User::query()->where('public_id', $id)->firstOrFail();
        $client = rtrim((string) config('platform.auth.client_url'), '/');
        if (! hash_equals(sha1($user->getEmailForVerification()), $hash)) {
            return redirect("{$client}/?verified=0");
        }
        if (! $user->hasVerifiedEmail()) {
            $user->markEmailAsVerified();
            event(new Verified($user));
        }

        return redirect("{$client}/?verified=1");
    }

    public function export(Request $request, AccountService $accounts): JsonResponse
    {
        return response()->json($accounts->export($request->user()), 200, [
            'Content-Disposition' => 'attachment; filename="platform-account.json"',
        ]);
    }

    /** `{ "password" }`: settle what is open, then anonymise the account. */
    public function destroy(Request $request, AccountService $accounts): JsonResponse
    {
        $data = $request->validate(['password' => ['required', 'string']]);
        $accounts->delete($request->user(), $data['password']);

        return response()->json(['deleted' => true]);
    }
}
