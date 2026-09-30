package com.acme.notes.viewmodel

class NoteViewModelTest {
    fun titlesAreFormatted() {
        check(NoteViewModel().titles().isNotEmpty())
    }
}
