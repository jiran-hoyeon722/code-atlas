<?php

namespace App\Models;

use App\Enums\Status;
use Illuminate\Database\Eloquent\Model;

class Post extends Model
{
    protected $casts = ['status' => Status::class];

    public function author()
    {
        return $this->belongsTo(User::class);
    }

    public static function drafts()
    {
        return static::query()->where('status', Status::Draft);
    }

    public function sameAs($other): bool
    {
        return $other instanceof Post && self::class === Post::class;
    }
}
