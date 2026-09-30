<?php

namespace Tests\Feature;

use Tests\TestCase;

class LoanFlowTest extends TestCase
{
    public function test_shelves_page_responds(): void
    {
        $response = $this->get('/shelves');
        $response->assertOk();
    }
}
