import { Grid } from "./grid";

// Bitmask direction: up=1, right=2, down=4, left=8
export const U = 1;
export const R = 2;
export const D = 4;
export const L = 8;

const MASK_TO_CHAR: Record<number, string> = {
  [U]: "│",
  [D]: "│",
  [U | D]: "│",
  [L]: "─",
  [R]: "─",
  [L | R]: "─",
  [R | D]: "┌",
  [L | D]: "┐",
  [U | R]: "└",
  [U | L]: "┘",
  [U | D | R]: "├",
  [U | D | L]: "┤",
  [L | R | D]: "┬",
  [L | R | U]: "┴",
  [U | D | L | R]: "┼",
};

const CHAR_TO_MASK: Record<string, number> = {};
for (const [mask, ch] of Object.entries(MASK_TO_CHAR)) {
  if (!(ch in CHAR_TO_MASK)) CHAR_TO_MASK[ch] = Number(mask);
}
// Rounded corners map to the same masks as sharp corners so they merge sanely.
CHAR_TO_MASK["╭"] = R | D;
CHAR_TO_MASK["╮"] = L | D;
CHAR_TO_MASK["╰"] = U | R;
CHAR_TO_MASK["╯"] = U | L;

export function mergeMask(existing: string | undefined, newMask: number): string {
  if (newMask === 0) return existing ?? " ";
  const curMask = existing && CHAR_TO_MASK[existing] ? CHAR_TO_MASK[existing] : 0;
  const merged = curMask | newMask;
  return MASK_TO_CHAR[merged] ?? MASK_TO_CHAR[newMask] ?? existing ?? " ";
}

// ---------------------------------------------------------------------------
// Box
// ---------------------------------------------------------------------------

export type BoxStyle = "sharp" | "rounded";

export function drawBox(
  grid: Grid,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  style: BoxStyle = "sharp",
) {
  const xa = Math.min(x1, x2);
  const xb = Math.max(x1, x2);
  const ya = Math.min(y1, y2);
  const yb = Math.max(y1, y2);
  if (xa === xb && ya === yb) return;

  for (let x = xa + 1; x < xb; x++) {
    grid.set(x, ya, mergeMask(grid.get(x, ya), L | R));
    grid.set(x, yb, mergeMask(grid.get(x, yb), L | R));
  }
  for (let y = ya + 1; y < yb; y++) {
    grid.set(xa, y, mergeMask(grid.get(xa, y), U | D));
    grid.set(xb, y, mergeMask(grid.get(xb, y), U | D));
  }
  if (style === "rounded" && xa !== xb && ya !== yb) {
    grid.set(xa, ya, "╭");
    grid.set(xb, ya, "╮");
    grid.set(xa, yb, "╰");
    grid.set(xb, yb, "╯");
  } else {
    grid.set(xa, ya, mergeMask(grid.get(xa, ya), R | D));
    grid.set(xb, ya, mergeMask(grid.get(xb, ya), L | D));
    grid.set(xa, yb, mergeMask(grid.get(xa, yb), R | U));
    grid.set(xb, yb, mergeMask(grid.get(xb, yb), L | U));
  }
}

// ---------------------------------------------------------------------------
// Table — box + internal dividers, junctions auto-merged via mergeMask
// ---------------------------------------------------------------------------

export function drawTable(
  grid: Grid,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  cols: number,
  rows: number,
  style: BoxStyle = "sharp",
) {
  const xa = Math.min(x1, x2);
  const xb = Math.max(x1, x2);
  const ya = Math.min(y1, y2);
  const yb = Math.max(y1, y2);
  const w = xb - xa;
  const h = yb - ya;
  if (w < 2 || h < 2) return;
  const C = Math.max(1, Math.min(cols, w));
  const R2 = Math.max(1, Math.min(rows, h));
  drawBox(grid, xa, ya, xb, yb, style);
  // Vertical dividers
  for (let c = 1; c < C; c++) {
    const x = xa + Math.round((w * c) / C);
    if (x <= xa || x >= xb) continue;
    for (let y = ya + 1; y < yb; y++) {
      grid.set(x, y, mergeMask(grid.get(x, y), U | D));
    }
    grid.set(x, ya, mergeMask(grid.get(x, ya), L | R | D));
    grid.set(x, yb, mergeMask(grid.get(x, yb), L | R | U));
  }
  // Horizontal dividers
  for (let r = 1; r < R2; r++) {
    const y = ya + Math.round((h * r) / R2);
    if (y <= ya || y >= yb) continue;
    for (let x = xa + 1; x < xb; x++) {
      grid.set(x, y, mergeMask(grid.get(x, y), L | R));
    }
    grid.set(xa, y, mergeMask(grid.get(xa, y), U | D | R));
    grid.set(xb, y, mergeMask(grid.get(xb, y), U | D | L));
  }
}

/**
 * Bangun table dengan posisi divider eksplisit (bukan jumlah merata).
 * Dipakai untuk resize kolom: rebuild layout setelah divider digeser.
 */
export function drawTableLayout(
  grid: Grid,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  colXs: number[],
  rowYs: number[],
  style: BoxStyle = "sharp",
) {
  const xa = Math.min(x1, x2);
  const xb = Math.max(x1, x2);
  const ya = Math.min(y1, y2);
  const yb = Math.max(y1, y2);
  if (xb - xa < 2 || yb - ya < 2) return;
  drawBox(grid, xa, ya, xb, yb, style);
  for (const x of colXs) {
    if (x <= xa || x >= xb) continue;
    for (let y = ya + 1; y < yb; y++) {
      grid.set(x, y, mergeMask(grid.get(x, y), U | D));
    }
    grid.set(x, ya, mergeMask(grid.get(x, ya), L | R | D));
    grid.set(x, yb, mergeMask(grid.get(x, yb), L | R | U));
  }
  for (const y of rowYs) {
    if (y <= ya || y >= yb) continue;
    for (let x = xa + 1; x < xb; x++) {
      grid.set(x, y, mergeMask(grid.get(x, y), L | R));
    }
    grid.set(xa, y, mergeMask(grid.get(xa, y), U | D | R));
    grid.set(xb, y, mergeMask(grid.get(xb, y), U | D | L));
  }
}

// ---------------------------------------------------------------------------
// Line (orthogonal L-shape, horizontal-first by default)
// ---------------------------------------------------------------------------

export function computePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  horizontalFirst = true,
): Array<[number, number]> {
  const path: Array<[number, number]> = [];
  if (x1 === x2 && y1 === y2) {
    path.push([x1, y1]);
    return path;
  }
  if (horizontalFirst) {
    const dx = Math.sign(x2 - x1);
    if (dx !== 0) {
      for (let x = x1; x !== x2; x += dx) path.push([x, y1]);
    }
    const dy = Math.sign(y2 - y1);
    if (dy !== 0) {
      for (let y = dx === 0 ? y1 : y1; y !== y2; y += dy) {
        path.push([x2, y]);
      }
    }
    path.push([x2, y2]);
  } else {
    const dy = Math.sign(y2 - y1);
    if (dy !== 0) {
      for (let y = y1; y !== y2; y += dy) path.push([x1, y]);
    }
    const dx = Math.sign(x2 - x1);
    if (dx !== 0) {
      for (let x = dy === 0 ? x1 : x1; x !== x2; x += dx) {
        path.push([x, y2]);
      }
    }
    path.push([x2, y2]);
  }
  return path;
}

export function drawLine(
  grid: Grid,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  horizontalFirst = true,
) {
  const path = computePath(x1, y1, x2, y2, horizontalFirst);
  for (let i = 0; i < path.length; i++) {
    const [x, y] = path[i];
    let mask = 0;
    if (i > 0) {
      const [px, py] = path[i - 1];
      if (px === x - 1) mask |= L;
      else if (px === x + 1) mask |= R;
      else if (py === y - 1) mask |= U;
      else if (py === y + 1) mask |= D;
    }
    if (i < path.length - 1) {
      const [nx, ny] = path[i + 1];
      if (nx === x - 1) mask |= L;
      else if (nx === x + 1) mask |= R;
      else if (ny === y - 1) mask |= U;
      else if (ny === y + 1) mask |= D;
    }
    if (mask !== 0) {
      grid.set(x, y, mergeMask(grid.get(x, y), mask));
    }
  }
}

// ---------------------------------------------------------------------------
// Arrow
// ---------------------------------------------------------------------------

export function drawArrow(
  grid: Grid,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  horizontalFirst = true,
) {
  if (x1 === x2 && y1 === y2) return;
  drawLine(grid, x1, y1, x2, y2, horizontalFirst);
  const path = computePath(x1, y1, x2, y2, horizontalFirst);
  if (path.length < 2) return;
  const [px, py] = path[path.length - 2];
  let head = "▶";
  if (px === x2 - 1) head = "▶";
  else if (px === x2 + 1) head = "◀";
  else if (py === y2 - 1) head = "▼";
  else if (py === y2 + 1) head = "▲";
  grid.set(x2, y2, head);
}

// ---------------------------------------------------------------------------
// Erase region
// ---------------------------------------------------------------------------

export function eraseRegion(
  grid: Grid,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  const xa = Math.min(x1, x2);
  const xb = Math.max(x1, x2);
  const ya = Math.min(y1, y2);
  const yb = Math.max(y1, y2);
  for (let x = xa; x <= xb; x++) {
    for (let y = ya; y <= yb; y++) {
      grid.delete(x, y);
    }
  }
}
