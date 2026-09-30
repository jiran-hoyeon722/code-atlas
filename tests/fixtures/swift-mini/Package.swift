// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "Notes",
    targets: [
        .target(name: "NotesKit"),
        .executableTarget(name: "NotesApp", dependencies: ["NotesKit"]),
        .testTarget(name: "NotesKitTests", dependencies: ["NotesKit"]),
    ]
)
