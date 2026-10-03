<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        RateLimiter::for('auth', fn (Request $request) => [
            Limit::perMinute(10)->by('ip:'.$request->ip()),
            Limit::perMinute(5)->by('login:'.strtolower((string) $request->input('login', $request->input('email')))),
        ]);
        RateLimiter::for('tickets', fn (Request $request) => Limit::perMinute(12)->by('user:'.$request->user()?->id));
        RateLimiter::for('economy', fn (Request $request) => Limit::perMinute(30)->by('user:'.$request->user()?->id));
    }
}
