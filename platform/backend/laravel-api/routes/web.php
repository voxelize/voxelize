<?php

use Illuminate\Support\Facades\Route;

// The backend is API-only; the website and admin panel are separate apps.
Route::get('/', fn () => response()->json([
    'service' => 'platform-api',
    'api' => url('/api/v1'),
]));
