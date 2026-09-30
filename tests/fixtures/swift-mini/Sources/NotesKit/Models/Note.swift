public struct Note: Equatable {
    public let id: Int
    public var title: String
    public var tags: [Tag]
}

public enum Tag: String {
    case work
    case home
}
