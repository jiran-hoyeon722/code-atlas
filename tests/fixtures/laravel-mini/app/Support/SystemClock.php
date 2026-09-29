<?php

namespace App\Support;

use App\Contracts\Clock;

final class SystemClock implements Clock
{
    public function now(): int
    {
        return time();
    }
}
