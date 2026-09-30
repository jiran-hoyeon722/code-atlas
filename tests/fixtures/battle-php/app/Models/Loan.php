<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Loan extends Model
{
    protected $fillable = ['volume_id', 'reader_id', 'due_at', 'returned_at'];

    protected $casts = [
        'due_at' => 'datetime',
        'returned_at' => 'datetime',
    ];

    public function volume(): BelongsTo
    {
        return $this->belongsTo(Volume::class);
    }

    public function reader(): BelongsTo
    {
        return $this->belongsTo(Reader::class);
    }

    public function isOpen(): bool
    {
        return $this->returned_at === null;
    }
}
