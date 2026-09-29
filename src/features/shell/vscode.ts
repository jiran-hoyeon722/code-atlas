const key = (name: string) => `code-atlas:vscode:${name}`;

export function getRepoRoot(name: string): string | null {
  try {
    return localStorage.getItem(key(name));
  } catch {
    return null;
  }
}

export function setRepoRoot(name: string, path: string): void {
  try {
    localStorage.setItem(key(name), path);
  } catch {
    // storage unavailable (private mode etc.): setting just won't persist
  }
}

export function vscodeHref(root: string, path: string): string {
  const base = root.replace(/\\/g, '/').replace(/\/+$/, '');
  return `vscode://file${base.startsWith('/') ? '' : '/'}${base}/${path}`;
}
