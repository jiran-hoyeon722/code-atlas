extension Note: CustomStringConvertible {
    public var description: String {
        tags.isEmpty ? title : "\(title) #\(tags.count)"
    }
}
