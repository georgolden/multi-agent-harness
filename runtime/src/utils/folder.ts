import { runTreeCommand } from '../tools/tree.js';

export interface FolderInfo {
  path: string;
  tree: string;
}

export class Folder {
  path: string;
  tree: string;

  constructor({ path, tree }: { path: string; tree: string }) {
    this.path = path;
    this.tree = tree;
  }

  static read = async (path: string) => {
    const tree = await runTreeCommand(path);
    return new Folder({ path, tree });
  };

  toJSON() {
    return { path: this.path, tree: this.tree };
  }
}
