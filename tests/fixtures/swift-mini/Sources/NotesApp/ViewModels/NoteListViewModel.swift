import Foundation
import NotesKit

final class NoteListViewModel: ObservableObject {
    @Published private(set) var titles: [String] = []
    private let store: NoteStoring

    init(store: NoteStoring) {
        self.store = store
    }

    func reload() {
        titles = store.all().map { Formatter.title($0.title) }
    }
}
