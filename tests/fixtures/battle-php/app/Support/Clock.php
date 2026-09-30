<?php

namespace App\Support;

use DateTimeImmutable;

class Clock
{
    private ?DateTimeImmutable $frozen = null;

    public function now(): DateTimeImmutable
    {
        return $this->frozen ?? new DateTimeImmutable();
    }

    public function freeze(DateTimeImmutable $at): void
    {
        $this->frozen = $at;
    }

    public function daysBetween(DateTimeImmutable $from, DateTimeImmutable $to): int
    {
        $diff = $from->diff($to);
        return $diff->invert ? -$diff->days : $diff->days;
    }
}
