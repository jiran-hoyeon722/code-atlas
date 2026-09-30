public protocol NoteStoring {
    func all() -> [Note]
    func add(_ title: String) -> Note
}
