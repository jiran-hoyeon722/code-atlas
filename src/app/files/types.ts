export interface DirNode {
  name: string;
  kind: 'directory';
  children(): AsyncIterable<DirNode | FileNode>;
}

export interface FileNode {
  name: string;
  kind: 'file';
  size: number;
  lastModified: number;
  text(): Promise<string>;
}

export type { DirNode as FsDir, FileNode as FsFile };

export interface Entry {
  path: string;
  size: number;
  lastModified: number;
  file: FileNode;
}

export interface Listing {
  name: string;
  sources: Entry[];
  configs: Entry[];
  tooLarge: string[];
}
