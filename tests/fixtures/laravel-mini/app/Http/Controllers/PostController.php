<?php

namespace App\Http\Controllers;

use App\Actions\CreatePost;
use App\Models\Post;
use Illuminate\Http\Request;

class PostController
{
    public function index()
    {
        return Post::query()->get();
    }

    public function store(Request $request, CreatePost $action): Post
    {
        return $action->handle($request->input('title'));
    }
}
