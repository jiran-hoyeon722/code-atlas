<?php

namespace Tests\Unit;

use App\Services\FineCalculator;
use App\Support\Clock;
use PHPUnit\Framework\TestCase;

class FineCalculatorTest extends TestCase
{
    public function test_summarize_of_nothing_is_zero(): void
    {
        $calc = new FineCalculator(new Clock());
        $this->assertSame(['total' => 0, 'count' => 0, 'worst' => 0], $calc->summarize([]));
    }
}
