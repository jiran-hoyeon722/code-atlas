<?php

namespace App\Providers;

use App\Events\PostCreated;
use App\Listeners\NotifyAuthor;
use Illuminate\Foundation\Support\Providers\EventServiceProvider as ServiceProvider;

class EventServiceProvider extends ServiceProvider
{
    protected $listen = [
        PostCreated::class => [
            NotifyAuthor::class,
        ],
    ];
}
