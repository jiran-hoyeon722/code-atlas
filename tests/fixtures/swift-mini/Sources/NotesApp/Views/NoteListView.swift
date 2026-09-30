import SwiftUI

struct NoteListView: View {
    @ObservedObject var model: NoteListViewModel

    var body: some View {
        List(model.titles, id: \.self) { title in
            Text(title)
        }
        .onAppear { model.reload() }
    }
}
