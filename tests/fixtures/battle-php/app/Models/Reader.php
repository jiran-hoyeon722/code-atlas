<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Reader extends Model
{
    protected $fillable = ['name', 'card_number', 'tier', 'blocked'];

    protected $casts = ['blocked' => 'boolean'];

    public function loans(): HasMany
    {
        return $this->hasMany(Loan::class);
    }

    public function openLoans(): int
    {
        return $this->loans()->whereNull('returned_at')->count();
    }

    public function loanLimit(): int
    {
        return match ($this->tier) {
            'student' => 3,
            'staff' => 10,
            'guest' => 1,
            default => 5,
        };
    }
}
