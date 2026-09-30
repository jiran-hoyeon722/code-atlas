<?php

namespace App\Services;

use App\Models\Shelf;

class ShelfReport
{
    private array $cache = [];

    public function __construct(private LendingService $lending)
    {
    }

    public function forget(int $shelfId): void
    {
        unset($this->cache[$shelfId]);
    }

    public function build(Shelf $shelf): array
    {
        if (isset($this->cache[$shelf->id])) {
            return $this->cache[$shelf->id];
        }
        $rows = [];
        foreach ($shelf->volumes as $volume) {
            $open = $volume->loans()->whereNull('returned_at')->get()->all();
            $rows[] = [
                'title' => $volume->title,
                'available' => $volume->availableCopies(),
                'overdue' => count($this->lending->overdue($open)),
            ];
        }
        return $this->cache[$shelf->id] = $rows;
    }
}
