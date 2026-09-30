public final class NoteStore: NoteStoring {
    private var notes: [Note] = []

    public init() {}

    public func all() -> [Note] { notes }

    public func add(_ title: String) -> Note {
        let note = Note(id: notes.count, title: title, tags: [Tag.work])
        guard !title.isEmpty else { return note }
        notes.append(note)
        return note
    }
}
