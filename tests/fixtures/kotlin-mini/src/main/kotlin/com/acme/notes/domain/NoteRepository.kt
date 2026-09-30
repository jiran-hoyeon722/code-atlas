package com.acme.notes.domain

interface NoteRepository {
    fun all(): List<Note>
}
