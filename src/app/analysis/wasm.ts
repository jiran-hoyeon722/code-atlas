import type { WasmFile } from '../../engine/parsers';

export function wasmLocate(base: string): (file: WasmFile) => string {
  return (file) => `${base}wasm/${file}`;
}
