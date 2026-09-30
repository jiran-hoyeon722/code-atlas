<?php

namespace App\Http\Controllers;

use App\Models\Shelf;
use App\Services\ShelfReport;

class ShelfController extends Controller
{
    public function __construct(private ShelfReport $report)
    {
    }

    public function index(): array
    {
        $out = [];
        foreach (Shelf::all() as $shelf) {
            $rows = $this->report->build($shelf);
            $out[] = [
                'label' => $shelf->fullLabel(),
                'volumes' => count($rows),
                'available' => array_sum(array_column($rows, 'available')),
            ];
        }
        return $this->ok($out);
    }
}
