<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Volume extends Model
{
    protected $fillable = ['title', 'shelf_id', 'copies', 'reference_only'];

    protected $casts = [
        'reference_only' => 'boolean',
        'copies' => 'integer',
    ];

    public function shelf(): BelongsTo
    {
        return $this->belongsTo(Shelf::class);
    }

    public function loans(): HasMany
    {
        return $this->hasMany(Loan::class);
    }

    public function availableCopies(): int
    {
        $out = $this->loans()->whereNull('returned_at')->count();
        return max(0, $this->copies - $out);
    }

    public function canLend(): bool
    {
        return !$this->reference_only && $this->availableCopies() > 0;
    }
}
