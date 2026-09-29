<?php

namespace App\Repositories;

use App\Contracts\PostRepository;
use App\Models\Post;

class EloquentPostRepository implements PostRepository
{
    public function all(): array
    {
        return Post::query()->get()->all();
    }
}
