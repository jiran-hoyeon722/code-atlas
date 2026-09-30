package com.acme.notes.viewmodel

import com.acme.notes.domain.*
import com.acme.notes.util.formatTitle
import com.acme.notes.util.Clock
import kotlin.collections.List

class NoteViewModel(private val repo: NoteRepository? = null) {
    val notes: List<Note> = repo?.all() ?: listOf(emptyNote())

    fun titles(): List<String> = notes.map { formatTitle(it.title) }

    fun label(note: Note): String = when (note.tag.name) {
        "work" -> "W"
        "home" -> "H"
        else -> "?"
    }
}
