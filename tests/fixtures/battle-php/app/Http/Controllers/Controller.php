<?php

namespace App\Http\Controllers;

abstract class Controller
{
    protected function ok(array $data): array
    {
        return ['ok' => true, 'data' => $data];
    }

    protected function fail(string $message): array
    {
        return ['ok' => false, 'error' => $message];
    }
}
