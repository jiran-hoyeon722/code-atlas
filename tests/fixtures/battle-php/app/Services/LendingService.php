<?php

namespace App\Services;

use App\Models\Loan;
use App\Models\Reader;
use App\Models\Volume;
use App\Support\Clock;
use RuntimeException;

class LendingService
{
    public function __construct(
        private Clock $clock,
        private FineCalculator $fines,
        private ShelfReport $report,
    ) {
    }

    public function lend(Reader $reader, Volume $volume): Loan
    {
        if ($reader->blocked) {
            throw new RuntimeException('Reader is blocked');
        }
        if ($reader->openLoans() >= $reader->loanLimit()) {
            throw new RuntimeException('Loan limit reached');
        }
        if (!$volume->canLend()) {
            throw new RuntimeException('No copy available');
        }
        $days = $reader->tier === 'staff' ? 28 : 14;
        $loan = new Loan([
            'volume_id' => $volume->id,
            'reader_id' => $reader->id,
            'due_at' => $this->clock->now()->modify("+{$days} days"),
        ]);
        $loan->save();
        $this->report->forget($volume->shelf_id);
        return $loan;
    }

    public function giveBack(Loan $loan): int
    {
        if (!$loan->isOpen()) {
            return 0;
        }
        $loan->returned_at = $this->clock->now();
        $loan->save();
        $fine = $this->fines->fineFor($loan);
        if ($fine > 1000) {
            $loan->reader->blocked = true;
            $loan->reader->save();
        }
        return $fine;
    }

    public function overdue(array $loans): array
    {
        $now = $this->clock->now();
        return array_values(array_filter($loans, fn (Loan $l) => $l->isOpen() && $l->due_at < $now));
    }
}
