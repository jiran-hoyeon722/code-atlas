<?php

namespace App\Services;

use App\Models\Loan;
use App\Support\Clock;

class FineCalculator
{
    public function __construct(private Clock $clock)
    {
    }

    public function fineFor(Loan $loan): int
    {
        $end = $loan->returned_at ?? $this->clock->now();
        $late = $this->clock->daysBetween($loan->due_at, $end);
        if ($late <= 0) {
            return 0;
        }
        $rate = $loan->reader->tier === 'student' ? 10 : 25;
        $fine = $late * $rate;
        if ($late > 30) {
            $fine += 500;
        }
        return min($fine, 5000);
    }

    public function summarize(array $loans): array
    {
        $total = 0;
        $count = 0;
        $worst = 0;
        foreach ($loans as $loan) {
            $fine = $this->fineFor($loan);
            if ($fine > 0) {
                $total += $fine;
                $count++;
                $worst = max($worst, $fine);
            }
        }
        return ['total' => $total, 'count' => $count, 'worst' => $worst];
    }
}
