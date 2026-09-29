<?php

namespace App\Listeners;

use App\Events\PostCreated;

class NotifyAuthor
{
    public function handle(PostCreated $event): void
    {
        if ($event->post->author instanceof \App\Models\User) {
            \LegacyFormatter::format('notified');
        }
    }
}
