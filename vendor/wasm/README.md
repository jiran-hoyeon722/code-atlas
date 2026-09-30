# vendor/wasm

npm 에 wasm 이 없는 문법을 여기에 그대로 넣어 둔다. `scripts/copy-wasm.mjs` 가 `public/wasm/` 으로 복사하고, 테스트·스크립트는 `src/engine/node.ts` 의 `nodeLocate` 로 이 파일을 쓴다.

| 파일 | 출처 | 버전 | 라이선스 | sha256 |
|---|---|---|---|---|
| `tree-sitter-swift.wasm` | [alex-pinkus/tree-sitter-swift](https://github.com/alex-pinkus/tree-sitter-swift) GitHub 릴리스 첨부 파일 — https://github.com/alex-pinkus/tree-sitter-swift/releases/download/0.7.3/tree-sitter-swift.wasm | 태그 `0.7.3` | MIT (Copyright (c) 2021 alex-pinkus) | `0258a7ef17303a8079ffe0748b3583d59656b5c3e8653fca7b6451b3e6689eb2` |

다시 받기: `gh release download 0.7.3 -R alex-pinkus/tree-sitter-swift -p tree-sitter-swift.wasm -D vendor/wasm`
