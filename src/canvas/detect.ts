import { Grid } from "./grid";

export const DRAWING_CHARS = new Set<string>([
  "─", "│",
  "┌", "┐", "└", "┘",
  "├", "┤", "┬", "┴", "┼",
  "╭", "╮", "╰", "╯",
  "▶", "◀", "▲", "▼",
]);

export function isDrawingChar(ch: string | undefined): boolean {
  if (!ch) return false;
  return DRAWING_CHARS.has(ch);
}

/**
 * Smart detect: klik cell → cari "shape" utuh di sekitarnya.
 * - Drawing char → flood fill semua drawing chars yang terhubung (box/line/arrow)
 * - Text char → walk horizontal kontigu (word/label)
 * - Kosong → empty set
 */
export function smartDetect(grid: Grid, x: number, y: number): Set<string> {
  const ch = grid.get(x, y);
  if (!ch) return new Set();
  if (isDrawingChar(ch)) return floodFillDrawing(grid, x, y);
  return walkTextBlock(grid, x, y);
}

function floodFillDrawing(grid: Grid, sx: number, sy: number): Set<string> {
  const visited = new Set<string>();
  const stack: Array<[number, number]> = [[sx, sy]];
  while (stack.length) {
    const [x, y] = stack.pop()!;
    const k = Grid.key(x, y);
    if (visited.has(k)) continue;
    const ch = grid.get(x, y);
    if (!isDrawingChar(ch)) continue;
    visited.add(k);
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return visited;
}

function walkTextBlock(grid: Grid, sx: number, sy: number): Set<string> {
  const result = new Set<string>();
  for (let x = sx; ; x--) {
    const ch = grid.get(x, sy);
    if (!ch || isDrawingChar(ch)) break;
    result.add(Grid.key(x, sy));
  }
  for (let x = sx + 1; ; x++) {
    const ch = grid.get(x, sy);
    if (!ch || isDrawingChar(ch)) break;
    result.add(Grid.key(x, sy));
  }
  return result;
}

/**
 * Deteksi table dari selection. Table = outer box + ≥1 internal divider
 * (vertical atau horizontal). Return posisi eksplisit tiap divider supaya
 * resize bisa redraw persis layout yang sama.
 */
export function detectTable(
  grid: Grid,
  selection: Set<string>,
):
  | {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      colXs: number[];
      rowYs: number[];
      style: "sharp" | "rounded";
    }
  | null {
  if (selection.size < 8) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const k of selection) {
    const [x, y] = Grid.parseKey(k);
    if (x < x1) x1 = x;
    if (y < y1) y1 = y;
    if (x > x2) x2 = x;
    if (y > y2) y2 = y;
  }
  const w = x2 - x1 + 1;
  const h = y2 - y1 + 1;
  if (w < 4 || h < 3) return null;
  // Entire perimeter must be in selection + drawing chars
  for (let x = x1; x <= x2; x++) {
    if (!selection.has(Grid.key(x, y1))) return null;
    if (!selection.has(Grid.key(x, y2))) return null;
    if (!isDrawingChar(grid.get(x, y1))) return null;
    if (!isDrawingChar(grid.get(x, y2))) return null;
  }
  for (let y = y1; y <= y2; y++) {
    if (!selection.has(Grid.key(x1, y))) return null;
    if (!selection.has(Grid.key(x2, y))) return null;
    if (!isDrawingChar(grid.get(x1, y))) return null;
    if (!isDrawingChar(grid.get(x2, y))) return null;
  }
  const topDiv = new Set(["┬", "┼"]);
  const botDiv = new Set(["┴", "┼"]);
  const lDiv = new Set(["├", "┼"]);
  const rDiv = new Set(["┤", "┼"]);
  const colXs: number[] = [];
  for (let x = x1 + 1; x < x2; x++) {
    const top = grid.get(x, y1);
    const bot = grid.get(x, y2);
    if (top && bot && topDiv.has(top) && botDiv.has(bot)) colXs.push(x);
  }
  const rowYs: number[] = [];
  for (let y = y1 + 1; y < y2; y++) {
    const l = grid.get(x1, y);
    const r = grid.get(x2, y);
    if (l && r && lDiv.has(l) && rDiv.has(r)) rowYs.push(y);
  }
  if (colXs.length === 0 && rowYs.length === 0) return null;
  const tl = grid.get(x1, y1);
  const style = tl === "╭" ? "rounded" : "sharp";
  return { x1, y1, x2, y2, colXs, rowYs, style };
}

/**
 * Jika `selection` adalah simple path (line/arrow, boleh L-shape) dengan
 * tepat 2 endpoint dan semua cell bagian di antara punya 2 tetangga dalam
 * selection, kembalikan info endpoint + apakah ini arrow.
 * Return null untuk loop tertutup (box) atau shape bercabang.
 */
export function detectLine(
  grid: Grid,
  selection: Set<string>,
):
  | {
      endpoints: [{ x: number; y: number }, { x: number; y: number }];
      headIndex: 0 | 1 | null;
    }
  | null {
  if (selection.size < 2) return null;
  const endpoints: Array<{ x: number; y: number }> = [];
  for (const k of selection) {
    const [x, y] = Grid.parseKey(k);
    if (!isDrawingChar(grid.get(x, y))) return null;
    let n = 0;
    if (selection.has(Grid.key(x + 1, y))) n++;
    if (selection.has(Grid.key(x - 1, y))) n++;
    if (selection.has(Grid.key(x, y + 1))) n++;
    if (selection.has(Grid.key(x, y - 1))) n++;
    if (n === 1) endpoints.push({ x, y });
    else if (n !== 2) return null;
  }
  if (endpoints.length !== 2) return null;
  const arrows = new Set(["▶", "◀", "▲", "▼"]);
  let headIndex: 0 | 1 | null = null;
  for (let i = 0; i < 2; i++) {
    const ch = grid.get(endpoints[i].x, endpoints[i].y);
    if (ch && arrows.has(ch)) {
      headIndex = i as 0 | 1;
      break;
    }
  }
  return { endpoints: [endpoints[0], endpoints[1]], headIndex };
}

/**
 * Snap titik (x,y) ke drawing-char terdekat dalam radius tertentu.
 * Return posisi snap atau null kalau tidak ada yang dekat.
 * Urutan cek: cell itu sendiri → tetangga orthogonal → diagonal.
 */
/**
 * Jika `selection` persis merupakan perimeter sebuah box (tanpa isi, tanpa
 * sambungan ke shape lain), kembalikan bounds + style-nya. Selain itu null.
 */
export function detectBox(
  grid: Grid,
  selection: Set<string>,
): { x1: number; y1: number; x2: number; y2: number; style: "sharp" | "rounded" } | null {
  if (selection.size < 4) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const k of selection) {
    const [x, y] = Grid.parseKey(k);
    if (x < x1) x1 = x;
    if (y < y1) y1 = y;
    if (x > x2) x2 = x;
    if (y > y2) y2 = y;
  }
  const w = x2 - x1 + 1;
  const h = y2 - y1 + 1;
  if (w < 2 || h < 2) return null;
  const expected = 2 * w + 2 * h - 4;
  if (selection.size !== expected) return null;
  for (const k of selection) {
    const [x, y] = Grid.parseKey(k);
    const onPerim = x === x1 || x === x2 || y === y1 || y === y2;
    if (!onPerim) return null;
    if (!isDrawingChar(grid.get(x, y))) return null;
  }
  const tl = grid.get(x1, y1);
  const style = tl === "╭" ? "rounded" : "sharp";
  return { x1, y1, x2, y2, style };
}

export function snapToDrawing(
  grid: Grid,
  x: number,
  y: number,
  radius = 1,
): { x: number; y: number } | null {
  if (isDrawingChar(grid.get(x, y))) return { x, y };
  // Orthogonal neighbors first (priority over diagonals)
  const order: Array<[number, number]> = [];
  for (let r = 1; r <= radius; r++) {
    order.push([r, 0], [-r, 0], [0, r], [0, -r]);
    order.push([r, r], [-r, r], [r, -r], [-r, -r]);
  }
  for (const [dx, dy] of order) {
    if (isDrawingChar(grid.get(x + dx, y + dy))) {
      return { x: x + dx, y: y + dy };
    }
  }
  return null;
}
