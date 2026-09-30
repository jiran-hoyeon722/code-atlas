<?php

namespace App\Providers;

use App\Services\FineCalculator;
use App\Support\Clock;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(Clock::class, fn () => new Clock());
        $this->app->singleton(FineCalculator::class, fn ($app) => new FineCalculator($app->make(Clock::class)));
    }

    public function boot(): void
    {
    }
}
