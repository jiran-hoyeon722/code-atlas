<?php

namespace App\Http\Controllers;

use App\Models\Loan;
use App\Models\Reader;
use App\Models\Volume;
use App\Services\LendingService;
use Illuminate\Http\Request;
use RuntimeException;

class LoanController extends Controller
{
    public function __construct(private LendingService $lending)
    {
    }

    public function store(Request $request): array
    {
        $reader = Reader::findOrFail($request->input('reader_id'));
        $volume = Volume::findOrFail($request->input('volume_id'));
        try {
            $loan = $this->lending->lend($reader, $volume);
        } catch (RuntimeException $e) {
            return $this->fail($e->getMessage());
        }
        return $this->ok(['loan' => $loan->id, 'due' => $loan->due_at->format('Y-m-d')]);
    }

    public function giveBack(int $id): array
    {
        $loan = Loan::findOrFail($id);
        $fine = $this->lending->giveBack($loan);
        return $this->ok(['fine' => $fine]);
    }
}
