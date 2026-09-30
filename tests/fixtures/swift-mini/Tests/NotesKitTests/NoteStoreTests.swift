import XCTest
@testable import NotesKit

final class NoteStoreTests: XCTestCase {
    func testAddKeepsTitle() {
        let store = NoteStore()
        XCTAssertEqual(store.add("a").title, "a")
    }
}
