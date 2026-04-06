import { useEffect, useRef, useState } from "react";
import { Grid } from "./grid";
import { computePath, drawArrow, drawBox, drawLine, drawTable, drawTableLayout, eraseRegion, type BoxStyle } from "./draw";
import { detectBox, detectLine, detectTable, isDrawingChar, smartDetect, snapToDrawing } from "./detect";
import { TEMPLATES } from "./templates";
import { parseTabular, renderAsciiTable } from "./tableFormat";

export type ToolId = "box" | "line" | "arrow" | "text" | "erase" | "select" | "table";

const CELL_W_BASE = 10;
const CELL_H_BASE = 18;
const FONT_BASE = 14;
// Logical column guide for 80-char convention; content is unbounded.
const COL_GUIDE = 80;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;

type Props = {
  initial: string;
  onChange: (text: string) => void;
};

type Point = { x: number; y: number };

/**
 * Stamp arrow head char on an already-drawn line path.
 * headAtAnchor=true → place head at `anchor`; false → place at `cursor`.
 */
function stampHead(
  grid: Grid,
  anchor: Point,
  cursor: Point,
  horizontalFirst: boolean,
  headAtAnchor: boolean,
) {
  if (anchor.x === cursor.x && anchor.y === cursor.y) return;
  const path = computePath(anchor.x, anchor.y, cursor.x, cursor.y, horizontalFirst);
  if (path.length < 2) return;
  const headIdx = headAtAnchor ? 0 : path.length - 1;
  const prevIdx = headAtAnchor ? 1 : path.length - 2;
  const [hx, hy] = path[headIdx];
  const [px, py] = path[prevIdx];
  let ch = "▶";
  if (px === hx - 1) ch = "▶";
  else if (px === hx + 1) ch = "◀";
  else if (py === hy - 1) ch = "▼";
  else if (py === hy + 1) ch = "▲";
  grid.set(hx, hy, ch);
}

/**
 * Scale divider positions proportionally from old span to new span.
 * Drops dividers that collapse onto a wall or duplicate another divider.
 */
function scaleDividers(
  vs: number[],
  oldStart: number,
  oldEnd: number,
  newStart: number,
  newEnd: number,
): number[] {
  const oldSize = oldEnd - oldStart;
  const newSize = newEnd - newStart;
  if (oldSize <= 0 || newSize <= 0) return [];
  const out: number[] = [];
  const seen = new Set<number>();
  for (const v of vs) {
    const scaled = newStart + Math.round(((v - oldStart) / oldSize) * newSize);
    if (scaled <= newStart || scaled >= newEnd) continue;
    if (seen.has(scaled)) continue;
    seen.add(scaled);
    out.push(scaled);
  }
  return out.sort((a, b) => a - b);
}

export function CanvasEditor({ initial, onChange }: Props) {
  // ── Tool & style ──
  const [tool, setTool] = useState<ToolId>("box");
  const [boxStyle, setBoxStyle] = useState<BoxStyle>("sharp");
  const [tableCols, setTableCols] = useState(3);
  const [tableRows, setTableRows] = useState(3);
  const [zoom, setZoom] = useState(1);
  const [viewport, setViewport] = useState({ w: 800, h: 600 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef(pan);
  panRef.current = pan;
  const spaceDownRef = useRef(false);
  const panDragRef = useRef<null | { startX: number; startY: number; startPan: { x: number; y: number } }>(null);

  // ── Data ──
  const [grid, setGrid] = useState<Grid>(() => Grid.fromString(initial));
  const gridRef = useRef<Grid>(grid);
  gridRef.current = grid;

  // ── Text input ──
  const [cursor, setCursor] = useState<Point | null>(null);

  // ── Selection ──
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const selectionRef = useRef<Set<string>>(selection);
  selectionRef.current = selection;
  const [moveOffset, setMoveOffset] = useState<Point | null>(null);
  const [regionRect, setRegionRect] = useState<
    { x1: number; y1: number; x2: number; y2: number } | null
  >(null);
  const [pasteFloat, setPasteFloat] = useState<Grid | null>(null);
  const [pasteAt, setPasteAt] = useState<Point | null>(null);

  // ── Drag state ──
  const dragMode = useRef<"draw" | "region" | "move" | "resize" | null>(null);
  const dragStart = useRef<Point | null>(null);
  const scratch = useRef<Grid>(new Grid());
  const hover = useRef<Point | null>(null);
  const [resizeAnchor, setResizeAnchor] = useState<Point | null>(null);
  const resizeStyleRef = useRef<BoxStyle>("sharp");
  // Line/arrow endpoint drag
  const [lineDrag, setLineDrag] = useState<null | {
    anchor: Point;
    isArrow: boolean;
    draggingHead: boolean;
  }>(null);
  const lineHfRef = useRef(true);
  // Table divider drag (column, row, or outer resize)
  const [tableDrag, setTableDrag] = useState<null | {
    bounds: { x1: number; y1: number; x2: number; y2: number };
    colXs: number[];
    rowYs: number[];
    style: BoxStyle;
    kind: "col" | "row" | "outer";
    idx: number;
    current: number; // for col/row: new x or y
    anchor?: Point; // for outer: fixed opposite corner
    cursor?: Point; // for outer: dragged corner position
  }>(null);

  // ── Clipboard (internal) ──
  const clipboardRef = useRef<Grid | null>(null);

  // ── Undo/Redo ──
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);

  // ── Toast ──
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 1600);
  };

  // ── Force render ──
  const [, tick] = useState(0);
  const render = () => tick(t => t + 1);

  // ── Refs ──
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);

  // One-time initial load
  useEffect(() => {
    if (!initializedRef.current && initial) {
      setGrid(Grid.fromString(initial));
    }
    initializedRef.current = true;
  }, [initial]);


  // ── Helpers ──
  const cellW = CELL_W_BASE * zoom;
  const cellH = CELL_H_BASE * zoom;
  const fontPx = FONT_BASE * zoom;

  const commit = (next: Grid, { pushUndo = true } = {}) => {
    if (pushUndo) {
      undoStack.current.push(gridRef.current.toString());
      if (undoStack.current.length > 100) undoStack.current.shift();
      redoStack.current = [];
    }
    setGrid(next);
    onChange(next.toString());
  };

  const clearSelection = () => {
    setSelection(new Set());
    setMoveOffset(null);
    setRegionRect(null);
  };

  // ── Render ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = viewport.w;
    const cssH = viewport.h;
    if (
      canvas.width !== Math.round(cssW * dpr) ||
      canvas.height !== Math.round(cssH * dpr)
    ) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#141414";
    ctx.fillRect(0, 0, cssW, cssH);

    // Translate to world space (pan offset)
    ctx.translate(-pan.x, -pan.y);

    // Visible world cell range
    const cx0 = Math.floor(pan.x / cellW);
    const cx1 = Math.ceil((pan.x + cssW) / cellW);
    const cy0 = Math.floor(pan.y / cellH);
    const cy1 = Math.ceil((pan.y + cssH) / cellH);

    // Faint grid
    ctx.strokeStyle = "#1d1d1d";
    ctx.lineWidth = 1;
    const gx0 = Math.floor(cx0 / 10) * 10;
    for (let x = gx0; x <= cx1; x += 10) {
      ctx.beginPath();
      ctx.moveTo(Math.round(x * cellW) + 0.5, cy0 * cellH);
      ctx.lineTo(Math.round(x * cellW) + 0.5, cy1 * cellH);
      ctx.stroke();
    }
    const gy0 = Math.floor(cy0 / 5) * 5;
    for (let y = gy0; y <= cy1; y += 5) {
      ctx.beginPath();
      ctx.moveTo(cx0 * cellW, Math.round(y * cellH) + 0.5);
      ctx.lineTo(cx1 * cellW, Math.round(y * cellH) + 0.5);
      ctx.stroke();
    }
    // Column-80 guide (only if visible)
    if (COL_GUIDE >= cx0 && COL_GUIDE <= cx1) {
      ctx.strokeStyle = "#2a2a2a";
      ctx.beginPath();
      ctx.moveTo(COL_GUIDE * cellW + 0.5, cy0 * cellH);
      ctx.lineTo(COL_GUIDE * cellW + 0.5, cy1 * cellH);
      ctx.stroke();
    }

    ctx.font = `${fontPx}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";

    // Selection highlight (under text)
    if (selection.size > 0) {
      ctx.fillStyle = "rgba(251,240,223,0.15)";
      const dx = moveOffset?.x ?? 0;
      const dy = moveOffset?.y ?? 0;
      for (const k of selection) {
        const [x, y] = Grid.parseKey(k);
        ctx.fillRect(
          (x + dx) * cellW,
          (y + dy) * cellH,
          cellW,
          cellH,
        );
      }
    }

    // Committed grid (skip cells in selection if moving/resizing)
    ctx.fillStyle = "#e8e8e8";
    const hideSelected = moveOffset !== null || resizeAnchor !== null || lineDrag !== null || tableDrag !== null;
    for (const [x, y, ch] of grid.entries()) {
      const k = Grid.key(x, y);
      if (hideSelected && selection.has(k)) continue;
      ctx.fillText(ch, x * cellW + cellW / 2, y * cellH + cellH / 2);
    }

    // Selection cells at new position (if moving), or in place
    if (selection.size > 0 && resizeAnchor === null && lineDrag === null && tableDrag === null) {
      ctx.fillStyle = "#fbf0df";
      const dx = moveOffset?.x ?? 0;
      const dy = moveOffset?.y ?? 0;
      for (const k of selection) {
        const ch = grid.get(...(Grid.parseKey(k) as [number, number]));
        if (!ch) continue;
        const [x, y] = Grid.parseKey(k);
        ctx.fillText(
          ch,
          (x + dx) * cellW + cellW / 2,
          (y + dy) * cellH + cellH / 2,
        );
      }
    }

    // Scratch (drawing preview)
    ctx.fillStyle = "#fbf0df";
    for (const [x, y, ch] of scratch.current.entries()) {
      ctx.fillText(ch, x * cellW + cellW / 2, y * cellH + cellH / 2);
    }

    // Corner handles for a box-shaped selection (idle state only)
    if (
      tool === "select" &&
      selection.size > 0 &&
      moveOffset === null &&
      resizeAnchor === null &&
      lineDrag === null &&
      tableDrag === null &&
      !regionRect &&
      !pasteFloat
    ) {
      const table = detectTable(grid, selection);
      const box = table ? null : detectBox(grid, selection);
      const line = table || box ? null : detectLine(grid, selection);
      if (table) {
        const hs = Math.max(4, Math.round(cellW * 0.5));
        ctx.fillStyle = "#fbf0df";
        ctx.strokeStyle = "#141414";
        ctx.lineWidth = 1;
        const midY = Math.floor((table.y1 + table.y2) / 2);
        for (const cx of table.colXs) {
          const px = cx * cellW + cellW / 2 - hs / 2;
          const py = midY * cellH + cellH / 2 - hs / 2;
          ctx.fillRect(px, py, hs, hs);
          ctx.strokeRect(px + 0.5, py + 0.5, hs - 1, hs - 1);
        }
        const midX = Math.floor((table.x1 + table.x2) / 2);
        for (const ry of table.rowYs) {
          const px = midX * cellW + cellW / 2 - hs / 2;
          const py = ry * cellH + cellH / 2 - hs / 2;
          ctx.fillRect(px, py, hs, hs);
          ctx.strokeRect(px + 0.5, py + 0.5, hs - 1, hs - 1);
        }
        // Outer corner handles for whole-table resize
        for (const [cx, cy] of [
          [table.x1, table.y1],
          [table.x2, table.y1],
          [table.x1, table.y2],
          [table.x2, table.y2],
        ] as const) {
          const px = cx * cellW + cellW / 2 - hs / 2;
          const py = cy * cellH + cellH / 2 - hs / 2;
          ctx.fillRect(px, py, hs, hs);
          ctx.strokeRect(px + 0.5, py + 0.5, hs - 1, hs - 1);
        }
      }
      if (line) {
        const hs = Math.max(4, Math.round(cellW * 0.5));
        ctx.fillStyle = "#fbf0df";
        ctx.strokeStyle = "#141414";
        ctx.lineWidth = 1;
        for (const ep of line.endpoints) {
          const px = ep.x * cellW + cellW / 2 - hs / 2;
          const py = ep.y * cellH + cellH / 2 - hs / 2;
          ctx.fillRect(px, py, hs, hs);
          ctx.strokeRect(px + 0.5, py + 0.5, hs - 1, hs - 1);
        }
      }
      if (box) {
        const hs = Math.max(4, Math.round(cellW * 0.5));
        ctx.fillStyle = "#fbf0df";
        ctx.strokeStyle = "#141414";
        ctx.lineWidth = 1;
        for (const [cx, cy] of [
          [box.x1, box.y1],
          [box.x2, box.y1],
          [box.x1, box.y2],
          [box.x2, box.y2],
        ] as const) {
          const px = cx * cellW + cellW / 2 - hs / 2;
          const py = cy * cellH + cellH / 2 - hs / 2;
          ctx.fillRect(px, py, hs, hs);
          ctx.strokeRect(px + 0.5, py + 0.5, hs - 1, hs - 1);
        }
      }
    }

    // Paste float preview
    if (pasteFloat && pasteAt) {
      ctx.fillStyle = "rgba(251,240,223,0.15)";
      const b = pasteFloat.bounds();
      if (b) {
        const w = b.x2 - b.x1 + 1;
        const h = b.y2 - b.y1 + 1;
        ctx.fillRect(pasteAt.x * cellW, pasteAt.y * cellH, w * cellW, h * cellH);
      }
      ctx.fillStyle = "#fbf0df";
      for (const [x, y, ch] of pasteFloat.entries()) {
        const nx = x - (b?.x1 ?? 0) + pasteAt.x;
        const ny = y - (b?.y1 ?? 0) + pasteAt.y;
        ctx.fillText(ch, nx * cellW + cellW / 2, ny * cellH + cellH / 2);
      }
    }

    // Region drag rect
    if (regionRect) {
      const xa = Math.min(regionRect.x1, regionRect.x2);
      const xb = Math.max(regionRect.x1, regionRect.x2);
      const ya = Math.min(regionRect.y1, regionRect.y2);
      const yb = Math.max(regionRect.y1, regionRect.y2);
      ctx.strokeStyle = "#fbf0df";
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(
        xa * cellW + 0.5,
        ya * cellH + 0.5,
        (xb - xa + 1) * cellW,
        (yb - ya + 1) * cellH,
      );
      ctx.setLineDash([]);
    }

    // Hover cell
    if (hover.current && !regionRect) {
      ctx.strokeStyle = "rgba(251,240,223,0.35)";
      ctx.strokeRect(
        hover.current.x * cellW + 0.5,
        hover.current.y * cellH + 0.5,
        cellW,
        cellH,
      );
    }

    // Text cursor
    if (cursor && tool === "text") {
      ctx.fillStyle = "#fbf0df";
      ctx.fillRect(
        cursor.x * cellW,
        cursor.y * cellH + cellH - 2,
        cellW,
        2,
      );
    }
  });

  // ── Mouse helpers ──
  const cellAt = (e: React.MouseEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left + pan.x) / cellW);
    const y = Math.floor((e.clientY - rect.top + pan.y) / cellH);
    return { x, y };
  };

  const onMouseDown = (e: React.MouseEvent) => {
    // Middle-mouse or space+drag → pan
    if (e.button === 1 || spaceDownRef.current) {
      e.preventDefault();
      panDragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startPan: { ...panRef.current },
      };
      return;
    }
    const cell = cellAt(e);

    // If a paste is floating, clicking anywhere drops it.
    if (pasteFloat && pasteAt) {
      const next = gridRef.current.clone();
      const b = pasteFloat.bounds();
      if (b) {
        next.mergeWithOffset(pasteFloat, pasteAt.x - b.x1, pasteAt.y - b.y1);
      }
      commit(next);
      // Move selection to dropped cells
      const newSel = new Set<string>();
      if (b) {
        for (const k of pasteFloat.keys()) {
          const [x, y] = Grid.parseKey(k);
          newSel.add(Grid.key(x - b.x1 + pasteAt.x, y - b.y1 + pasteAt.y));
        }
      }
      setSelection(newSel);
      setPasteFloat(null);
      setPasteAt(null);
      return;
    }

    if (tool === "text") {
      setCursor(cell);
      return;
    }

    if (tool === "select") {
      // Table column drag — click on any cell along an internal col divider
      const table = detectTable(gridRef.current, selectionRef.current);
      if (table) {
        // Outer corner hit → resize whole table
        const corners: Array<[number, number, number, number]> = [
          [table.x1, table.y1, table.x2, table.y2],
          [table.x2, table.y1, table.x1, table.y2],
          [table.x1, table.y2, table.x2, table.y1],
          [table.x2, table.y2, table.x1, table.y1],
        ];
        const outerHit = corners.find(
          ([cx, cy]) => cx === cell.x && cy === cell.y,
        );
        if (outerHit) {
          const anchor = { x: outerHit[2], y: outerHit[3] };
          dragMode.current = "resize";
          dragStart.current = anchor;
          setTableDrag({
            bounds: { x1: table.x1, y1: table.y1, x2: table.x2, y2: table.y2 },
            colXs: [...table.colXs],
            rowYs: [...table.rowYs],
            style: table.style,
            kind: "outer",
            idx: 0,
            current: 0,
            anchor,
            cursor: cell,
          });
          scratch.current = new Grid();
          drawTableLayout(
            scratch.current,
            anchor.x,
            anchor.y,
            cell.x,
            cell.y,
            scaleDividers(table.colXs, table.x1, table.x2, Math.min(anchor.x, cell.x), Math.max(anchor.x, cell.x)),
            scaleDividers(table.rowYs, table.y1, table.y2, Math.min(anchor.y, cell.y), Math.max(anchor.y, cell.y)),
            table.style,
          );
          render();
          return;
        }
        const colIdx = table.colXs.findIndex(
          cx => cx === cell.x && cell.y >= table.y1 && cell.y <= table.y2,
        );
        const rowIdx =
          colIdx === -1
            ? table.rowYs.findIndex(
                ry => ry === cell.y && cell.x >= table.x1 && cell.x <= table.x2,
              )
            : -1;
        if (colIdx !== -1 || rowIdx !== -1) {
          const kind: "col" | "row" = colIdx !== -1 ? "col" : "row";
          const idx = kind === "col" ? colIdx : rowIdx;
          const current = kind === "col" ? table.colXs[colIdx] : table.rowYs[rowIdx];
          dragMode.current = "resize";
          dragStart.current = { x: cell.x, y: cell.y };
          setTableDrag({
            bounds: { x1: table.x1, y1: table.y1, x2: table.x2, y2: table.y2 },
            colXs: [...table.colXs],
            rowYs: [...table.rowYs],
            style: table.style,
            kind,
            idx,
            current,
          });
          render();
          return;
        }
        // Clicking elsewhere on a table → fall through to move/smart-detect
      }
      // Check resize handle first — hit if click lands on any of the 4 box corners
      const box = table ? null : detectBox(gridRef.current, selectionRef.current);
      if (box) {
        const corners: Array<[number, number, number, number]> = [
          [box.x1, box.y1, box.x2, box.y2],
          [box.x2, box.y1, box.x1, box.y2],
          [box.x1, box.y2, box.x2, box.y1],
          [box.x2, box.y2, box.x1, box.y1],
        ];
        const hit = corners.find(([cx, cy]) => cx === cell.x && cy === cell.y);
        if (hit) {
          dragMode.current = "resize";
          dragStart.current = { x: hit[2], y: hit[3] };
          resizeStyleRef.current = box.style;
          setResizeAnchor({ x: hit[2], y: hit[3] });
          scratch.current = new Grid();
          drawBox(scratch.current, hit[2], hit[3], cell.x, cell.y, box.style);
          render();
          return;
        }
      }
      // Line/arrow endpoint drag
      if (!box) {
        const line = detectLine(gridRef.current, selectionRef.current);
        if (line) {
          const hitIdx = line.endpoints.findIndex(
            ep => ep.x === cell.x && ep.y === cell.y,
          );
          if (hitIdx !== -1) {
            const anchor = line.endpoints[1 - hitIdx];
            const isArrow = line.headIndex !== null;
            const draggingHead = line.headIndex === hitIdx;
            dragMode.current = "resize";
            dragStart.current = anchor;
            setLineDrag({ anchor, isArrow, draggingHead });
            scratch.current = new Grid();
            const hf =
              selectionRef.current.has(Grid.key(anchor.x + 1, anchor.y)) ||
              selectionRef.current.has(Grid.key(anchor.x - 1, anchor.y));
            lineHfRef.current = hf;
            if (isArrow && draggingHead) {
              drawArrow(scratch.current, anchor.x, anchor.y, cell.x, cell.y, hf);
            } else {
              drawLine(scratch.current, anchor.x, anchor.y, cell.x, cell.y, hf);
              if (isArrow) stampHead(scratch.current, anchor, cell, hf, true);
            }
            render();
            return;
          }
        }
      }
      const k = Grid.key(cell.x, cell.y);
      const inSelection = selectionRef.current.has(k);
      if (inSelection) {
        // Start move drag
        dragMode.current = "move";
        dragStart.current = cell;
        setMoveOffset({ x: 0, y: 0 });
        return;
      }
      const ch = gridRef.current.get(cell.x, cell.y);
      if (ch) {
        // Smart detect
        const detected = smartDetect(gridRef.current, cell.x, cell.y);
        if (e.shiftKey) {
          const merged = new Set(selectionRef.current);
          for (const k of detected) merged.add(k);
          setSelection(merged);
        } else {
          setSelection(detected);
        }
        return;
      }
      // Empty → start region drag
      if (!e.shiftKey) clearSelection();
      dragMode.current = "region";
      dragStart.current = cell;
      setRegionRect({ x1: cell.x, y1: cell.y, x2: cell.x, y2: cell.y });
      return;
    }

    // Drawing tools
    dragMode.current = "draw";
    dragStart.current = cell;
    scratch.current = new Grid();
    render();
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (panDragRef.current) {
      const d = panDragRef.current;
      setPan({
        x: Math.max(0, d.startPan.x - (e.clientX - d.startX)),
        y: Math.max(0, d.startPan.y - (e.clientY - d.startY)),
      });
      return;
    }
    const cell = cellAt(e);
    hover.current = cell;
    if (pasteFloat) {
      setPasteAt(cell);
      return;
    }

    if (dragMode.current === "draw" && dragStart.current) {
      const { x: sx, y: sy } = dragStart.current;
      scratch.current = new Grid();
      let endX = cell.x;
      let endY = cell.y;
      if (tool === "line" || tool === "arrow") {
        const snap = snapToDrawing(gridRef.current, cell.x, cell.y, 1);
        if (snap) {
          endX = snap.x;
          endY = snap.y;
        }
      }
      if (tool === "box") drawBox(scratch.current, sx, sy, endX, endY, boxStyle);
      else if (tool === "table") drawTable(scratch.current, sx, sy, endX, endY, tableCols, tableRows, boxStyle);
      else if (tool === "line") drawLine(scratch.current, sx, sy, endX, endY);
      else if (tool === "arrow") drawArrow(scratch.current, sx, sy, endX, endY);
      else if (tool === "erase") {
        const xa = Math.min(sx, endX);
        const xb = Math.max(sx, endX);
        const ya = Math.min(sy, endY);
        const yb = Math.max(sy, endY);
        for (let x = xa; x <= xb; x++) {
          for (let y = ya; y <= yb; y++) scratch.current.set(x, y, "·");
        }
      }
    } else if (dragMode.current === "region" && dragStart.current) {
      setRegionRect({
        x1: dragStart.current.x,
        y1: dragStart.current.y,
        x2: cell.x,
        y2: cell.y,
      });
    } else if (dragMode.current === "move" && dragStart.current) {
      setMoveOffset({
        x: cell.x - dragStart.current.x,
        y: cell.y - dragStart.current.y,
      });
    } else if (dragMode.current === "resize" && dragStart.current && tableDrag && tableDrag.kind === "outer") {
      const { bounds, colXs, rowYs, anchor, style } = tableDrag;
      if (!anchor) return;
      const nx1 = Math.min(anchor.x, cell.x);
      const nx2 = Math.max(anchor.x, cell.x);
      const ny1 = Math.min(anchor.y, cell.y);
      const ny2 = Math.max(anchor.y, cell.y);
      scratch.current = new Grid();
      if (nx2 - nx1 >= 2 && ny2 - ny1 >= 2) {
        drawTableLayout(
          scratch.current,
          nx1,
          ny1,
          nx2,
          ny2,
          scaleDividers(colXs, bounds.x1, bounds.x2, nx1, nx2),
          scaleDividers(rowYs, bounds.y1, bounds.y2, ny1, ny2),
          style,
        );
      }
      setTableDrag({ ...tableDrag, cursor: cell });
    } else if (dragMode.current === "resize" && dragStart.current && tableDrag) {
      const { bounds, colXs, rowYs, kind, idx } = tableDrag;
      let nextCols = colXs;
      let nextRows = rowYs;
      let nextCurrent = tableDrag.current;
      if (kind === "col") {
        const minX = (idx === 0 ? bounds.x1 : colXs[idx - 1]) + 1;
        const maxX = (idx === colXs.length - 1 ? bounds.x2 : colXs[idx + 1]) - 1;
        nextCurrent = Math.max(minX, Math.min(maxX, cell.x));
        nextCols = [...colXs];
        nextCols[idx] = nextCurrent;
      } else {
        const minY = (idx === 0 ? bounds.y1 : rowYs[idx - 1]) + 1;
        const maxY = (idx === rowYs.length - 1 ? bounds.y2 : rowYs[idx + 1]) - 1;
        nextCurrent = Math.max(minY, Math.min(maxY, cell.y));
        nextRows = [...rowYs];
        nextRows[idx] = nextCurrent;
      }
      scratch.current = new Grid();
      drawTableLayout(
        scratch.current,
        bounds.x1,
        bounds.y1,
        bounds.x2,
        bounds.y2,
        nextCols,
        nextRows,
        tableDrag.style,
      );
      setTableDrag({ ...tableDrag, current: nextCurrent });
    } else if (dragMode.current === "resize" && dragStart.current) {
      scratch.current = new Grid();
      if (lineDrag) {
        const anchor = dragStart.current;
        const hf = lineHfRef.current;
        if (lineDrag.isArrow && lineDrag.draggingHead) {
          drawArrow(scratch.current, anchor.x, anchor.y, cell.x, cell.y, hf);
        } else {
          drawLine(scratch.current, anchor.x, anchor.y, cell.x, cell.y, hf);
          if (lineDrag.isArrow) {
            stampHead(scratch.current, anchor, cell, hf, true);
          }
        }
      } else {
        drawBox(
          scratch.current,
          dragStart.current.x,
          dragStart.current.y,
          cell.x,
          cell.y,
          resizeStyleRef.current,
        );
      }
    }
    render();
  };

  const onMouseUp = (e: React.MouseEvent) => {
    if (panDragRef.current) {
      panDragRef.current = null;
      return;
    }
    const cell = cellAt(e);

    if (dragMode.current === "draw" && dragStart.current) {
      const { x: sx, y: sy } = dragStart.current;
      let endX = cell.x;
      let endY = cell.y;
      if (tool === "line" || tool === "arrow") {
        const snap = snapToDrawing(gridRef.current, cell.x, cell.y, 1);
        if (snap) {
          endX = snap.x;
          endY = snap.y;
        }
      }
      const next = gridRef.current.clone();
      if (tool === "box") drawBox(next, sx, sy, endX, endY, boxStyle);
      else if (tool === "table") drawTable(next, sx, sy, endX, endY, tableCols, tableRows, boxStyle);
      else if (tool === "line") drawLine(next, sx, sy, endX, endY);
      else if (tool === "arrow") drawArrow(next, sx, sy, endX, endY);
      else if (tool === "erase") eraseRegion(next, sx, sy, endX, endY);
      scratch.current = new Grid();
      commit(next);
    } else if (dragMode.current === "region" && regionRect) {
      const xa = Math.min(regionRect.x1, regionRect.x2);
      const xb = Math.max(regionRect.x1, regionRect.x2);
      const ya = Math.min(regionRect.y1, regionRect.y2);
      const yb = Math.max(regionRect.y1, regionRect.y2);
      const newSel = e.shiftKey ? new Set(selectionRef.current) : new Set<string>();
      for (let x = xa; x <= xb; x++) {
        for (let y = ya; y <= yb; y++) {
          const k = Grid.key(x, y);
          if (gridRef.current.hasKey(k)) newSel.add(k);
        }
      }
      setSelection(newSel);
      setRegionRect(null);
    } else if (dragMode.current === "resize" && dragStart.current && tableDrag && tableDrag.kind === "outer") {
      const { bounds, colXs, rowYs, style, anchor } = tableDrag;
      if (anchor) {
        const nx1 = Math.min(anchor.x, cell.x);
        const nx2 = Math.max(anchor.x, cell.x);
        const ny1 = Math.min(anchor.y, cell.y);
        const ny2 = Math.max(anchor.y, cell.y);
        if (nx2 - nx1 >= 3 && ny2 - ny1 >= 2 && (nx1 !== bounds.x1 || nx2 !== bounds.x2 || ny1 !== bounds.y1 || ny2 !== bounds.y2)) {
          const next = gridRef.current.clone();
          // Erase drawing chars in OLD bounds (preserve text)
          for (let x = bounds.x1; x <= bounds.x2; x++) {
            for (let y = bounds.y1; y <= bounds.y2; y++) {
              const ch = next.get(x, y);
              if (ch && isDrawingChar(ch)) next.delete(x, y);
            }
          }
          const newCols = scaleDividers(colXs, bounds.x1, bounds.x2, nx1, nx2);
          const newRows = scaleDividers(rowYs, bounds.y1, bounds.y2, ny1, ny2);
          drawTableLayout(next, nx1, ny1, nx2, ny2, newCols, newRows, style);
          scratch.current = new Grid();
          commit(next);
          const newSel = new Set<string>();
          for (let x = nx1; x <= nx2; x++) {
            for (let y = ny1; y <= ny2; y++) {
              const ch = next.get(x, y);
              if (ch && isDrawingChar(ch)) newSel.add(Grid.key(x, y));
            }
          }
          setSelection(newSel);
        } else {
          scratch.current = new Grid();
        }
      }
      setTableDrag(null);
    } else if (dragMode.current === "resize" && dragStart.current && tableDrag) {
      const { bounds, colXs, rowYs, style, kind, idx, current } = tableDrag;
      const original = kind === "col" ? colXs[idx] : rowYs[idx];
      if (current !== original) {
        const nextCols = kind === "col" ? [...colXs] : colXs;
        const nextRows = kind === "row" ? [...rowYs] : rowYs;
        if (kind === "col") (nextCols as number[])[idx] = current;
        else (nextRows as number[])[idx] = current;
        const next = gridRef.current.clone();
        // Erase only drawing chars inside bounds (keep text)
        for (let x = bounds.x1; x <= bounds.x2; x++) {
          for (let y = bounds.y1; y <= bounds.y2; y++) {
            const ch = next.get(x, y);
            if (ch && isDrawingChar(ch)) next.delete(x, y);
          }
        }
        drawTableLayout(
          next,
          bounds.x1,
          bounds.y1,
          bounds.x2,
          bounds.y2,
          nextCols,
          nextRows,
          style,
        );
        scratch.current = new Grid();
        commit(next);
        // New selection = all drawing chars in the bounds
        const newSel = new Set<string>();
        for (let x = bounds.x1; x <= bounds.x2; x++) {
          for (let y = bounds.y1; y <= bounds.y2; y++) {
            const ch = next.get(x, y);
            if (ch && isDrawingChar(ch)) newSel.add(Grid.key(x, y));
          }
        }
        setSelection(newSel);
      } else {
        scratch.current = new Grid();
      }
      setTableDrag(null);
    } else if (dragMode.current === "resize" && dragStart.current && lineDrag) {
      const anchor = dragStart.current;
      const hf = lineHfRef.current;
      if (anchor.x !== cell.x || anchor.y !== cell.y) {
        const next = gridRef.current.clone();
        next.deleteKeys(selectionRef.current);
        if (lineDrag.isArrow && lineDrag.draggingHead) {
          drawArrow(next, anchor.x, anchor.y, cell.x, cell.y, hf);
        } else {
          drawLine(next, anchor.x, anchor.y, cell.x, cell.y, hf);
          if (lineDrag.isArrow) stampHead(next, anchor, cell, hf, true);
        }
        scratch.current = new Grid();
        commit(next);
        const path = computePath(anchor.x, anchor.y, cell.x, cell.y, hf);
        const newSel = new Set<string>();
        for (const [x, y] of path) newSel.add(Grid.key(x, y));
        setSelection(newSel);
      } else {
        scratch.current = new Grid();
      }
      setLineDrag(null);
    } else if (dragMode.current === "resize" && dragStart.current) {
      const ax = dragStart.current.x;
      const ay = dragStart.current.y;
      if (Math.abs(cell.x - ax) >= 1 && Math.abs(cell.y - ay) >= 1) {
        const next = gridRef.current.clone();
        next.deleteKeys(selectionRef.current);
        drawBox(next, ax, ay, cell.x, cell.y, resizeStyleRef.current);
        scratch.current = new Grid();
        commit(next);
        const x1 = Math.min(ax, cell.x);
        const x2 = Math.max(ax, cell.x);
        const y1 = Math.min(ay, cell.y);
        const y2 = Math.max(ay, cell.y);
        const newSel = new Set<string>();
        for (let x = x1; x <= x2; x++) {
          newSel.add(Grid.key(x, y1));
          newSel.add(Grid.key(x, y2));
        }
        for (let y = y1; y <= y2; y++) {
          newSel.add(Grid.key(x1, y));
          newSel.add(Grid.key(x2, y));
        }
        setSelection(newSel);
      } else {
        scratch.current = new Grid();
      }
      setResizeAnchor(null);
    } else if (dragMode.current === "move" && moveOffset) {
      if (moveOffset.x !== 0 || moveOffset.y !== 0) {
        // Commit move
        const selected = gridRef.current.extractKeys(selection);
        const next = gridRef.current.clone();
        next.deleteKeys(selection);
        next.mergeWithOffset(selected, moveOffset.x, moveOffset.y);
        commit(next);
        // Update selection to new positions
        const newSel = new Set<string>();
        for (const k of selection) {
          const [x, y] = Grid.parseKey(k);
          newSel.add(Grid.key(x + moveOffset.x, y + moveOffset.y));
        }
        setSelection(newSel);
      }
      setMoveOffset(null);
    }

    dragMode.current = null;
    dragStart.current = null;
  };

  const onMouseLeave = () => {
    hover.current = null;
    render();
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const cell = cellAt(e);
    setTool("text");
    setCursor(cell);
  };

  // ── Zoom ──
  const setZoomClamped = (z: number) => {
    setZoom(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)));
  };
  const zoomToFit = () => {
    const b = gridRef.current.bounds();
    const scroller = scrollRef.current;
    if (!scroller) return;
    if (!b) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      return;
    }
    const margin = 4;
    const wCells = b.x2 - b.x1 + margin * 2;
    const hCells = b.y2 - b.y1 + margin * 2;
    const zx = scroller.clientWidth / (wCells * CELL_W_BASE);
    const zy = scroller.clientHeight / (hCells * CELL_H_BASE);
    const nz = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.min(zx, zy)));
    setZoom(nz);
    const ncw = CELL_W_BASE * nz;
    const nch = CELL_H_BASE * nz;
    const px = (b.x1 - margin) * ncw;
    const py = (b.y1 - margin) * nch;
    setPan({ x: Math.max(0, px), y: Math.max(0, py) });
  };

  // Viewport size tracking
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const update = () => setViewport({ w: scroller.clientWidth, h: scroller.clientHeight });
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(scroller);
    return () => ro.disconnect();
  }, []);

  // ── Wheel: bare = pan, ⌘/Ctrl = zoom around cursor ──
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) {
        const rect = scroller.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        setZoom(z => {
          const nz = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z + (e.deltaY > 0 ? -0.08 : 0.08)));
          if (nz === z) return z;
          // Keep world point under cursor stable
          const p = panRef.current;
          const worldX = (mx + p.x) / (CELL_W_BASE * z);
          const worldY = (my + p.y) / (CELL_H_BASE * z);
          const nx = worldX * CELL_W_BASE * nz - mx;
          const ny = worldY * CELL_H_BASE * nz - my;
          setPan({ x: Math.max(0, nx), y: Math.max(0, ny) });
          return nz;
        });
      } else {
        setPan(p => ({
          x: Math.max(0, p.x + e.deltaX),
          y: Math.max(0, p.y + e.deltaY),
        }));
      }
    };
    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", onWheel);
  }, []);

  // Space key for pan mode
  useEffect(() => {
    const dn = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target as HTMLElement)?.matches?.("input,textarea,[contenteditable]")) {
        spaceDownRef.current = true;
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceDownRef.current = false;
    };
    window.addEventListener("keydown", dn);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", dn);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // ── Copy / Paste ──
  const copyGridToOSClipboard = async (g: Grid) => {
    const text = g.toString();
    try {
      await navigator.clipboard.writeText(text);
      flashToast(`Tersalin (${text.length} karakter)`);
    } catch {
      flashToast("Gagal menyalin");
    }
  };

  const copySelectionToInternal = () => {
    if (selection.size === 0) return false;
    clipboardRef.current = gridRef.current.extractKeys(selection);
    flashToast(`${selection.size} sel tersalin`);
    return true;
  };

  const pasteAsTable = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const rows = parseTabular(text);
      if (!rows) {
        flashToast("Clipboard bukan TSV/CSV");
        return;
      }
      const ascii = renderAsciiTable(rows, boxStyle);
      stampTemplate(ascii);
      flashToast(`Tabel ${rows.length}×${rows[0]?.length ?? 0}`);
    } catch {
      flashToast("Gagal baca clipboard");
    }
  };

  const stampTemplate = (ascii: string) => {
    const g = Grid.fromString(ascii);
    if (g.size() === 0) return;
    const at = hover.current ?? { x: 2, y: 2 };
    setPasteFloat(g);
    setPasteAt(at);
    setTool("select");
  };

  const pasteFromExternal = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        flashToast("Clipboard kosong");
        return;
      }
      stampTemplate(text);
    } catch {
      flashToast("Gagal baca clipboard");
    }
  };

  const pasteFromInternal = () => {
    if (!clipboardRef.current || clipboardRef.current.size() === 0) return;
    const at = hover.current ?? { x: 0, y: 0 };
    setPasteFloat(clipboardRef.current.clone());
    setPasteAt(at);
    setTool("select");
  };

  const deleteSelection = () => {
    if (selection.size === 0) return;
    const next = gridRef.current.clone();
    next.deleteKeys(selection);
    commit(next);
    setSelection(new Set());
  };

  const nudge = (dx: number, dy: number) => {
    if (selection.size === 0) return;
    const selected = gridRef.current.extractKeys(selection);
    const next = gridRef.current.clone();
    next.deleteKeys(selection);
    next.mergeWithOffset(selected, dx, dy);
    commit(next);
    const newSel = new Set<string>();
    for (const k of selection) {
      const [x, y] = Grid.parseKey(k);
      newSel.add(Grid.key(x + dx, y + dy));
    }
    setSelection(newSel);
  };

  // ── Keyboard ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      // Don't hijack keys while user types in meta panel inputs.
      // Exception: mod-shortcuts (⌘⇧C etc) still pass so they work from anywhere.
      const target = e.target as HTMLElement | null;
      const inInput =
        target &&
        (target.tagName === "TEXTAREA" ||
          target.tagName === "INPUT" ||
          target.isContentEditable);
      if (inInput && !mod) return;

      // Undo / Redo
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        const snap = undoStack.current.pop();
        if (snap !== undefined) {
          redoStack.current.push(gridRef.current.toString());
          const restored = Grid.fromString(snap);
          setGrid(restored);
          onChange(restored.toString());
          clearSelection();
        }
        return;
      }
      if (
        mod &&
        (e.key.toLowerCase() === "y" ||
          (e.key.toLowerCase() === "z" && e.shiftKey))
      ) {
        e.preventDefault();
        const snap = redoStack.current.pop();
        if (snap !== undefined) {
          undoStack.current.push(gridRef.current.toString());
          const restored = Grid.fromString(snap);
          setGrid(restored);
          onChange(restored.toString());
          clearSelection();
        }
        return;
      }

      // Zoom
      if (mod && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        setZoom(z => Math.min(ZOOM_MAX, z + 0.1));
        return;
      }
      if (mod && e.key === "-") {
        e.preventDefault();
        setZoom(z => Math.max(ZOOM_MIN, z - 0.1));
        return;
      }
      if (mod && e.key === "0" && !e.shiftKey) {
        e.preventDefault();
        setZoom(1);
        return;
      }
      if (mod && e.key === "0" && e.shiftKey) {
        e.preventDefault();
        zoomToFit();
        return;
      }

      // Paste as table (from OS clipboard TSV/CSV) — ⌘⇧V
      if (mod && e.shiftKey && e.key.toLowerCase() === "v") {
        e.preventDefault();
        pasteAsTable();
        return;
      }

      // Copy as ASCII (whole canvas) — ⌘⇧C
      if (mod && e.shiftKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        const g =
          selection.size > 0
            ? gridRef.current.extractKeys(selection)
            : gridRef.current;
        copyGridToOSClipboard(g);
        return;
      }

      // Text input mode
      if (tool === "text" && cursor) {
        if (e.key === "Escape") {
          setCursor(null);
          return;
        }
        if (e.key === "Backspace") {
          e.preventDefault();
          const nx = cursor.x - 1;
          if (nx < 0) return;
          const next = gridRef.current.clone();
          next.delete(nx, cursor.y);
          commit(next);
          setCursor({ x: nx, y: cursor.y });
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          setCursor({ x: cursor.x, y: cursor.y + 1 });
          return;
        }
        if (e.key === "ArrowLeft") { setCursor({ x: cursor.x - 1, y: cursor.y }); return; }
        if (e.key === "ArrowRight") { setCursor({ x: cursor.x + 1, y: cursor.y }); return; }
        if (e.key === "ArrowUp") { setCursor({ x: cursor.x, y: cursor.y - 1 }); return; }
        if (e.key === "ArrowDown") { setCursor({ x: cursor.x, y: cursor.y + 1 }); return; }
        if (e.key.length === 1 && !mod) {
          e.preventDefault();
          const next = gridRef.current.clone();
          next.set(cursor.x, cursor.y, e.key);
          commit(next);
          setCursor({ x: cursor.x + 1, y: cursor.y });
          return;
        }
        return;
      }

      // Selection operations
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selection.size > 0) {
          e.preventDefault();
          deleteSelection();
          return;
        }
      }
      if (mod && e.key.toLowerCase() === "c" && !e.shiftKey) {
        if (selection.size > 0) {
          e.preventDefault();
          copySelectionToInternal();
          return;
        }
      }
      if (mod && e.key.toLowerCase() === "x") {
        if (selection.size > 0) {
          e.preventDefault();
          copySelectionToInternal();
          deleteSelection();
          return;
        }
      }
      if (mod && e.key.toLowerCase() === "v" && !e.shiftKey) {
        e.preventDefault();
        if (clipboardRef.current) pasteFromInternal();
        else pasteFromExternal();
        return;
      }
      if (mod && e.key.toLowerCase() === "d" && selection.size > 0) {
        e.preventDefault();
        copySelectionToInternal();
        pasteFromInternal();
        return;
      }
      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        const all = new Set<string>();
        for (const k of gridRef.current.keys()) all.add(k);
        setSelection(all);
        setTool("select");
        return;
      }

      // Arrow keys: nudge selection
      if (selection.size > 0 && !mod) {
        if (e.key === "ArrowLeft") { e.preventDefault(); nudge(-1, 0); return; }
        if (e.key === "ArrowRight") { e.preventDefault(); nudge(1, 0); return; }
        if (e.key === "ArrowUp") { e.preventDefault(); nudge(0, -1); return; }
        if (e.key === "ArrowDown") { e.preventDefault(); nudge(0, 1); return; }
      }

      // Tool shortcuts (single key, no mod)
      if (!mod) {
        if (e.key === "1") setTool("box");
        else if (e.key === "2") setTool("line");
        else if (e.key === "3") setTool("arrow");
        else if (e.key === "4") setTool("text");
        else if (e.key === "5") setTool("erase");
        else if (e.key === "6") setTool("select");
        else if (e.key === "7") setTool("table");
        else if (e.key === "Escape") {
          setCursor(null);
          clearSelection();
          setPasteFloat(null);
          setPasteAt(null);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool, cursor, selection]);

  return (
    <div className="canvas-wrap">
      <Toolbar
        tool={tool}
        setTool={setTool}
        boxStyle={boxStyle}
        setBoxStyle={setBoxStyle}
        tableCols={tableCols}
        setTableCols={setTableCols}
        tableRows={tableRows}
        setTableRows={setTableRows}
        zoom={zoom}
        setZoom={setZoomClamped}
        zoomToFit={zoomToFit}
        onClear={() => commit(new Grid())}
        onCopyAll={() => copyGridToOSClipboard(gridRef.current)}
        onStamp={stampTemplate}
        hasSelection={selection.size > 0}
      />
      <div className="canvas-scroll" ref={scrollRef}>
        <canvas
          ref={canvasRef}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseLeave}
          onDoubleClick={onDoubleClick}
        />
      </div>
      <div className="hint">
        <span>1 Box</span>
        <span>2 Line</span>
        <span>3 Arrow</span>
        <span>4 Text</span>
        <span>5 Erase</span>
        <span>6 Select</span>
        <span>7 Table</span>
        <span className="sep">·</span>
        <span>⌘Z Undo</span>
        <span>⌘+/- Zoom</span>
        <span>⌘⇧0 Fit</span>
        <span>Wheel Pan</span>
        <span>Space/Mid Drag</span>
        <span>⌘⇧C Copy ASCII</span>
        <span>⌘⇧V Paste table</span>
        <span>⌘C/V/X/D Select</span>
        <span>Esc</span>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function Toolbar({
  tool,
  setTool,
  boxStyle,
  setBoxStyle,
  tableCols,
  setTableCols,
  tableRows,
  setTableRows,
  zoom,
  setZoom,
  zoomToFit,
  onClear,
  onCopyAll,
  onStamp,
  hasSelection,
}: {
  tool: ToolId;
  setTool: (t: ToolId) => void;
  boxStyle: BoxStyle;
  setBoxStyle: (s: BoxStyle) => void;
  tableCols: number;
  setTableCols: (n: number) => void;
  tableRows: number;
  setTableRows: (n: number) => void;
  zoom: number;
  setZoom: (z: number) => void;
  zoomToFit: () => void;
  onClear: () => void;
  onCopyAll: () => void;
  onStamp: (ascii: string) => void;
  hasSelection: boolean;
}) {
  const [stampsOpen, setStampsOpen] = useState(false);
  const tools: Array<{ id: ToolId; label: string; key: string }> = [
    { id: "box", label: "Box", key: "1" },
    { id: "line", label: "Line", key: "2" },
    { id: "arrow", label: "Arrow", key: "3" },
    { id: "text", label: "Text", key: "4" },
    { id: "erase", label: "Erase", key: "5" },
    { id: "select", label: "Select", key: "6" },
    { id: "table", label: "Table", key: "7" },
  ];
  const clamp = (n: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, n));
  return (
    <div className="toolbar">
      {tools.map(t => (
        <button
          key={t.id}
          className={tool === t.id ? "tool active" : "tool"}
          onClick={() => setTool(t.id)}
          title={`${t.label} (${t.key})`}
        >
          {t.label} <span className="key">{t.key}</span>
        </button>
      ))}
      <div className="divider" />
      <button
        className={boxStyle === "rounded" ? "tool active" : "tool"}
        onClick={() => setBoxStyle(boxStyle === "sharp" ? "rounded" : "sharp")}
        title="Style kotak: sharp / rounded"
      >
        {boxStyle === "sharp" ? "▢" : "◇"} Box style
      </button>
      {tool === "table" && (
        <>
          <div className="divider" />
          <span className="zoom-label">cols</span>
          <button className="tool" onClick={() => setTableCols(clamp(tableCols - 1, 1, 20))} title="Kurangi kolom">−</button>
          <span className="zoom-label">{tableCols}</span>
          <button className="tool" onClick={() => setTableCols(clamp(tableCols + 1, 1, 20))} title="Tambah kolom">+</button>
          <span className="zoom-label">rows</span>
          <button className="tool" onClick={() => setTableRows(clamp(tableRows - 1, 1, 20))} title="Kurangi baris">−</button>
          <span className="zoom-label">{tableRows}</span>
          <button className="tool" onClick={() => setTableRows(clamp(tableRows + 1, 1, 20))} title="Tambah baris">+</button>
        </>
      )}
      <div className="divider" />
      <button className="tool" onClick={() => setZoom(zoom - 0.1)} title="Zoom out (⌘-)">−</button>
      <span className="zoom-label">{Math.round(zoom * 100)}%</span>
      <button className="tool" onClick={() => setZoom(zoom + 0.1)} title="Zoom in (⌘+)">+</button>
      <button className="tool" onClick={zoomToFit} title="Fit (⌘⇧0)">Fit</button>
      <button className="tool" onClick={() => setZoom(1)} title="Reset (⌘0)">1:1</button>
      <div className="spacer" />
      <div className="stamps-wrap">
        <button
          className={stampsOpen ? "tool active" : "tool"}
          onClick={() => setStampsOpen(o => !o)}
          title="Template / stamp library"
        >
          ▦ Templates
        </button>
        {stampsOpen && (
          <div className="stamps-popover" onMouseLeave={() => setStampsOpen(false)}>
            {TEMPLATES.map(t => (
              <button
                key={t.id}
                className="stamp-item"
                onClick={() => {
                  onStamp(t.ascii);
                  setStampsOpen(false);
                }}
                title={t.name}
              >
                <pre className="stamp-preview">{t.ascii}</pre>
                <div className="stamp-label">{t.name}</div>
              </button>
            ))}
          </div>
        )}
      </div>
      <button className="tool" onClick={onCopyAll} title="Copy seluruh diagram sebagai teks (⌘⇧C)">
        Copy ASCII
      </button>
      <button className="tool danger" onClick={onClear} title="Hapus semua">
        Clear
      </button>
    </div>
  );
}
