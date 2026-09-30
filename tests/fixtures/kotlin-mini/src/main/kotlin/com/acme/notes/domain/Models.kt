package com.acme.notes.domain

data class Note(val title: String, val tag: Tag)

class Tag(val name: String)

fun emptyNote(): Note = Note("", Tag(""))
