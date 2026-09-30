package com.acme.notes

import com.acme.notes.ui.NoteScreen

object NotesApp {
    fun start() = NoteScreen().show()
}

fun main() {
    NotesApp.start()
}
