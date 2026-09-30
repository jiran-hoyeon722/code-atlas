package com.acme.notes.ui

import com.acme.notes.viewmodel.NoteViewModel as Vm

class NoteScreen {
    private val vm = Vm()

    fun show() {
        for (title in vm.titles()) {
            if (title.isNotEmpty() && title != "-") println(title)
        }
    }
}
