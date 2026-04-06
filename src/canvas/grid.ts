/**
 * Sparse grid karakter — source of truth untuk diagram.
 * Setiap cell = 1 karakter Unicode. Space/undefined = kosong.
 */
export class Grid {
  private cells = new Map<string, string>();

  static key(x: number, y: number) {
    return `${x},${y}`;
  }

  static parseKey(key: string): [number, number] {
    const [x, y] = key.split(",").map(Number);
    return [x, y];
  }

  get(x: number, y: number): string | undefined {
    return this.cells.get(Grid.key(x, y));
  }

  set(x: number, y: number, ch: string) {
    if (!ch || ch === " ") {
      this.cells.delete(Grid.key(x, y));
    } else {
      this.cells.set(Grid.key(x, y), ch);
    }
  }

  delete(x: number, y: number) {
    this.cells.delete(Grid.key(x, y));
  }

  deleteKey(key: string) {
    this.cells.delete(key);
  }

  has(x: number, y: number): boolean {
    return this.cells.has(Grid.key(x, y));
  }

  hasKey(key: string): boolean {
    return this.cells.has(key);
  }

  size() {
    return this.cells.size;
  }

  keys(): IterableIterator<string> {
    return this.cells.keys();
  }

  entries(): Array<[number, number, string]> {
    const out: Array<[number, number, string]> = [];
    for (const [k, v] of this.cells) {
      const [x, y] = Grid.parseKey(k);
      out.push([x, y, v]);
    }
    return out;
  }

  clone(): Grid {
    const g = new Grid();
    for (const [k, v] of this.cells) g.cells.set(k, v);
    return g;
  }

  /** Compute bounds of all non-empty cells. Null if empty. */
  bounds(): { x1: number; y1: number; x2: number; y2: number } | null {
    if (this.cells.size === 0) return null;
    let x1 = Infinity;
    let y1 = Infinity;
    let x2 = -Infinity;
    let y2 = -Infinity;
    for (const k of this.cells.keys()) {
      const [x, y] = Grid.parseKey(k);
      if (x < x1) x1 = x;
      if (y < y1) y1 = y;
      if (x > x2) x2 = x;
      if (y > y2) y2 = y;
    }
    return { x1, y1, x2, y2 };
  }

  /** Bounds of a subset of keys. */
  static boundsOfKeys(
    keys: Iterable<string>,
  ): { x1: number; y1: number; x2: number; y2: number } | null {
    let x1 = Infinity;
    let y1 = Infinity;
    let x2 = -Infinity;
    let y2 = -Infinity;
    let found = false;
    for (const k of keys) {
      const [x, y] = Grid.parseKey(k);
      if (x < x1) x1 = x;
      if (y < y1) y1 = y;
      if (x > x2) x2 = x;
      if (y > y2) y2 = y;
      found = true;
    }
    return found ? { x1, y1, x2, y2 } : null;
  }

  /** Extract subset of keys as a new Grid, keeping original coordinates. */
  extractKeys(keys: Iterable<string>): Grid {
    const g = new Grid();
    for (const k of keys) {
      const ch = this.cells.get(k);
      if (ch) g.cells.set(k, ch);
    }
    return g;
  }

  /** Delete all given keys in place. */
  deleteKeys(keys: Iterable<string>) {
    for (const k of keys) this.cells.delete(k);
  }

  /** Merge another grid into this one, overwriting overlaps, with optional offset. */
  mergeWithOffset(other: Grid, dx = 0, dy = 0) {
    for (const [x, y, ch] of other.entries()) {
      this.set(x + dx, y + dy, ch);
    }
  }

  toString(): string {
    if (this.cells.size === 0) return "";
    const b = this.bounds()!;
    const lines: string[] = [];
    const maxY = Math.max(0, b.y2);
    const maxX = Math.max(0, b.x2);
    for (let y = 0; y <= maxY; y++) {
      let line = "";
      for (let x = 0; x <= maxX; x++) {
        line += this.get(x, y) ?? " ";
      }
      lines.push(line.replace(/ +$/, ""));
    }
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    return lines.join("\n");
  }

  static fromString(text: string): Grid {
    const g = new Grid();
    if (!text) return g;
    const lines = text.split(/\r?\n/);
    for (let y = 0; y < lines.length; y++) {
      const line = lines[y];
      for (let x = 0; x < line.length; x++) {
        const ch = line[x];
        if (ch && ch !== " ") g.set(x, y, ch);
      }
    }
    return g;
  }
}
