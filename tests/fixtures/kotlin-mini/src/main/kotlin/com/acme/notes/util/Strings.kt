package com.acme.notes.util

typealias Title = String

fun formatTitle(raw: String): Title = raw.trim().ifEmpty { "(untitled)" }
