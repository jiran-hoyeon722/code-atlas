<?php

namespace App\Providers;

use App\Contracts\Clock;
use App\Contracts\PostRepository;
use App\Repositories\EloquentPostRepository;
use App\Support\SystemClock;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public array $singletons = [
        Clock::class => SystemClock::class,
    ];

    public function register(): void
    {
        $this->app->bind(PostRepository::class, EloquentPostRepository::class);
    }
}
