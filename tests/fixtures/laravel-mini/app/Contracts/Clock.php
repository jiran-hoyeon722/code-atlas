<?php

namespace App\Contracts;

interface Clock
{
    public function now(): int;
}
