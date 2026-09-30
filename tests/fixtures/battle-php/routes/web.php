<?php

use App\Http\Controllers\LoanController;
use App\Http\Controllers\ShelfController;
use Illuminate\Support\Facades\Route;

Route::get('/shelves', [ShelfController::class, 'index']);
Route::post('/loans', [LoanController::class, 'store']);
Route::post('/loans/{id}/return', [LoanController::class, 'giveBack']);
