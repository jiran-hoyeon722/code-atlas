enum Formatter {
    static func title(_ raw: String) -> String {
        raw.isEmpty ? "Untitled" : raw
    }
}
