<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Shelf extends Model
{
    protected $fillable = ['label', 'floor'];

    public function volumes(): HasMany
    {
        return $this->hasMany(Volume::class);
    }

    public function fullLabel(): string
    {
        return sprintf('%s (floor %d)', $this->label, $this->floor);
    }
}
