<?php

namespace App\Actions;

use App\Contracts\Clock;
use App\Enums\Status;
use App\Events\PostCreated;
use App\Models\Post;
use App\Models\User;

class CreatePost
{
    public function __construct(private User $author)
    {
    }

    public function handle(string $title): Post
    {
        $post = new Post();
        $post->title = $title;
        $post->status = Status::Draft;
        $post->author_id = $this->author->id;
        PostCreated::dispatch($post);

        return $post;
    }
}
