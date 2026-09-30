import SwiftUI
import NotesKit

@main
struct NotesApp: App {
    var body: some Scene {
        WindowGroup {
            NoteListView(model: NoteListViewModel(store: NoteStore()))
        }
    }
}
