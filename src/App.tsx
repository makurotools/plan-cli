import { useEffect, useMemo, useRef, useState } from "react";
import "./index.css";
import { FileTree, type FileEntry } from "./FileTree";
import { CanvasEditor } from "./canvas/Canvas";
import {
  findDiagramBlocks,
  spliceDiagramAt,
  findTaskLines,
  toggleTaskLine,
} from "./planFile";

type SaveState = "idle" | "saving" | "saved" | "error" | "conflict";

type FileView = {
  path: string;
  absPath: string;
  mtime: number;
  raw: string;
};

export function App() {
  // ── Workspace ──
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [workspaceCwd, setWorkspaceCwd] = useState("");

  // ── Active file state ──
  const [raw, setRaw] = useState<string>("");
  const [absPath, setAbsPath] = useState("");

  // ── Save state ──
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [conflict, setConflict] = useState<null | FileView>(null);

  // ── Layout ──
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // ── In-file search ──
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchCursor, setSearchCursor] = useState(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const searchMatches = useMemo(() => {
    if (!searchOpen || !searchQuery) return [] as number[];
    const q = searchQuery.toLowerCase();
    const hay = raw.toLowerCase();
    const out: number[] = [];
    let from = 0;
    while (true) {
      const idx = hay.indexOf(q, from);
      if (idx === -1) break;
      out.push(idx);
      from = idx + Math.max(1, q.length);
    }
    return out;
  }, [searchOpen, searchQuery, raw]);

  // Precompute line+col for every match so we can draw overlays without
  // re-splitting raw on every render.
  const searchMatchPositions = useMemo(() => {
    if (searchMatches.length === 0) return [] as { line: number; col: number }[];
    // Walk raw once, tracking line starts, then binary-search each match.
    const lineStarts: number[] = [0];
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === "\n") lineStarts.push(i + 1);
    }
    const locate = (offset: number) => {
      let lo = 0;
      let hi = lineStarts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (lineStarts[mid] <= offset) lo = mid;
        else hi = mid - 1;
      }
      return { line: lo, col: offset - lineStarts[lo] };
    };
    return searchMatches.map(locate);
  }, [searchMatches, raw]);

  // Clamp cursor whenever matches change
  useEffect(() => {
    if (searchMatches.length === 0) {
      if (searchCursor !== 0) setSearchCursor(0);
      return;
    }
    if (searchCursor >= searchMatches.length) setSearchCursor(0);
  }, [searchMatches, searchCursor]);

  const focusMatch = (idx: number) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = searchMatches[idx];
    if (start === undefined) return;
    const end = start + searchQuery.length;
    // Do NOT call ta.focus() — that would steal focus from the search
    // input while the user is still typing. setSelectionRange still
    // renders the selection visually on an unfocused textarea.
    ta.setSelectionRange(start, end);
    // Scroll match into view: compute its line, center it.
    const lineIdx = raw.slice(0, start).split("\n").length - 1;
    const lh = editorMetrics.lineHeight || 21;
    const target =
      editorMetrics.paddingTop + lineIdx * lh - ta.clientHeight / 2;
    ta.scrollTop = Math.max(0, target);
  };

  const advanceSearch = (dir: 1 | -1) => {
    if (searchMatches.length === 0) return;
    const next =
      (searchCursor + dir + searchMatches.length) % searchMatches.length;
    setSearchCursor(next);
    focusMatch(next);
  };

  const openSearch = () => {
    setSearchOpen(true);
    // Prefill with current selection if any. Use rawRef because this
    // function is invoked from the global keydown listener whose
    // closure may capture stale `raw` state.
    const ta = textareaRef.current;
    if (ta) {
      const sel = rawRef.current.slice(ta.selectionStart, ta.selectionEnd);
      if (sel && !sel.includes("\n")) setSearchQuery(sel);
    }
    setTimeout(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }, 0);
  };

  const closeSearch = () => {
    setSearchOpen(false);
    textareaRef.current?.focus();
  };

  // Jump to first match automatically when query changes and matches exist
  useEffect(() => {
    if (!searchOpen || searchMatches.length === 0) return;
    focusMatch(0);
    setSearchCursor(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, searchOpen]);

  // ── Diagram modal ──
  // editingDiagram = index of block being edited; null = closed.
  const [editingDiagram, setEditingDiagram] = useState<number | null>(null);
  const editingInitialRef = useRef<string>("");
  const editingDraftRef = useRef<string>("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const diagramBlocks = useMemo(() => findDiagramBlocks(raw), [raw]);
  const taskLines = useMemo(() => findTaskLines(raw), [raw]);

  // Scroll state used to re-anchor floating diagram buttons
  const [editorScrollTop, setEditorScrollTop] = useState(0);
  // Nonce bumped on window resize — forces a re-render so the offscreen
  // culling that reads textarea.clientHeight runs against the new size,
  // even when lineHeight/scrollTop are unchanged.
  const [resizeNonce, setResizeNonce] = useState(0);
  void resizeNonce;
  // Measured line-height + padding-top of the textarea; read from
  // computed style once the element mounts / font loads.
  const [editorMetrics, setEditorMetrics] = useState({
    lineHeight: 0,
    paddingTop: 0,
    paddingLeft: 0,
    charWidth: 0,
  });

  useEffect(() => {
    let raf = 0;
    const readMetrics = () => {
      const ta = textareaRef.current;
      if (!ta) return;
      const cs = window.getComputedStyle(ta);
      let lineHeight = parseFloat(cs.lineHeight);
      const paddingTop = parseFloat(cs.paddingTop) || 0;
      const paddingLeft = parseFloat(cs.paddingLeft) || 0;
      // Fallback: if line-height resolves to "normal" or otherwise fails,
      // approximate from font-size. Without this the floating diagram
      // buttons silently fail to render.
      if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
        const fs = parseFloat(cs.fontSize);
        lineHeight = Number.isFinite(fs) && fs > 0 ? fs * 1.5 : 0;
      }
      if (lineHeight <= 0) {
        // Element not laid out yet — retry on next frame.
        raf = requestAnimationFrame(readMetrics);
        return;
      }
      // Measure monospace char width via canvas so checkbox overlays
      // align precisely to column positions in the textarea.
      let charWidth = 0;
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.font = `${cs.fontSize} ${cs.fontFamily}`;
          charWidth = ctx.measureText("M").width;
        }
      } catch {
        // ignore
      }
      if (charWidth <= 0) {
        const fs = parseFloat(cs.fontSize);
        charWidth = Number.isFinite(fs) && fs > 0 ? fs * 0.6 : 8;
      }
      setEditorMetrics(prev =>
        prev.lineHeight === lineHeight &&
        prev.paddingTop === paddingTop &&
        prev.paddingLeft === paddingLeft &&
        prev.charWidth === charWidth
          ? prev
          : { lineHeight, paddingTop, paddingLeft, charWidth },
      );
    };
    readMetrics();
    // Re-read after custom fonts finish loading — first paint may use a
    // fallback font with a slightly different line-height.
    if (typeof document !== "undefined" && document.fonts?.ready) {
      document.fonts.ready.then(readMetrics).catch(() => {});
    }
    // Resize invalidates clientHeight (used to cull offscreen buttons) and
    // may indirectly change metrics if the user zooms.
    const onResize = () => {
      readMetrics();
      setResizeNonce(n => n + 1);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [activePath]);

  // ── Refs ──
  const rawRef = useRef<string>("");
  const activePathRef = useRef<string | null>(null);
  const baseMtimeRef = useRef<number>(0);
  const dirtyRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveStateRef = useRef<SaveState>("idle");
  saveStateRef.current = saveState;

  // ── Load helpers ──
  const refreshFileList = async (): Promise<FileEntry[]> => {
    try {
      const r = await fetch("/api/files");
      if (!r.ok) return [];
      const data = await r.json();
      setFiles(data.files);
      if (data.cwd) setWorkspaceCwd(data.cwd);
      return data.files as FileEntry[];
    } catch {
      return [];
    }
  };

  const applyView = (view: FileView) => {
    activePathRef.current = view.path;
    setActivePath(view.path);
    rawRef.current = view.raw;
    baseMtimeRef.current = view.mtime;
    setRaw(view.raw);
    setAbsPath(view.absPath);
    dirtyRef.current = false;
    setConflict(null);
    setSaveState("idle");
  };

  const loadFile = async (path: string): Promise<boolean> => {
    try {
      const r = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
      if (!r.ok) {
        setSaveState("error");
        return false;
      }
      applyView(await r.json());
      return true;
    } catch {
      setSaveState("error");
      return false;
    }
  };

  const buildPayload = (nextRaw: string) => ({
    raw: nextRaw,
    baseMtime: baseMtimeRef.current,
  });

  const flushSave = async (): Promise<boolean> => {
    if (!dirtyRef.current || !activePathRef.current) return true;
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const path = activePathRef.current;
    setSaveState("saving");
    try {
      const res = await fetch(`/api/file?path=${encodeURIComponent(path)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildPayload(rawRef.current)),
      });
      if (res.status === 409) {
        setConflict(await res.json());
        setSaveState("conflict");
        return false;
      }
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as FileView;
      baseMtimeRef.current = data.mtime;
      dirtyRef.current = false;
      setSaveState("saved");
      return true;
    } catch {
      setSaveState("error");
      return false;
    }
  };

  const switchFile = async (path: string) => {
    if (path === activePathRef.current) return;
    if (dirtyRef.current) {
      const ok = await flushSave();
      if (!ok) return;
    }
    await loadFile(path);
  };

  // ── Initial load ──
  useEffect(() => {
    (async () => {
      const list = await refreshFileList();
      if (list.length === 0) {
        try {
          await fetch(`/api/file?path=${encodeURIComponent("PLAN.md")}`, {
            method: "POST",
          });
          const list2 = await refreshFileList();
          if (list2.length > 0) await loadFile(list2[0].path);
        } catch {
          setSaveState("error");
        }
        return;
      }
      const preferred =
        list.find(f => f.path === "PLAN.md") ??
        list.find(f => f.path.toLowerCase() === "plan.md") ??
        list[0];
      await loadFile(preferred.path);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Poll active file mtime ──
  useEffect(() => {
    const id = setInterval(async () => {
      if (conflict) return;
      const path = activePathRef.current;
      if (!path) return;
      try {
        const res = await fetch(
          `/api/file/mtime?path=${encodeURIComponent(path)}`,
        );
        if (!res.ok) return;
        const { mtime } = await res.json();
        if (!baseMtimeRef.current || mtime === baseMtimeRef.current) return;
        const r = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
        if (!r.ok) return;
        const view = (await r.json()) as FileView;
        if (!dirtyRef.current && saveStateRef.current !== "saving") {
          applyView(view);
        } else {
          setConflict(view);
          setSaveState("conflict");
        }
      } catch {
        // ignore polling errors
      }
    }, 3000);
    return () => clearInterval(id);
  }, [conflict]);

  // Periodic file list refresh for external adds/removes
  useEffect(() => {
    const id = setInterval(() => {
      refreshFileList();
    }, 10000);
    return () => clearInterval(id);
  }, []);

  // ── Save scheduler ──
  const scheduleSave = (nextRaw: string) => {
    if (!activePathRef.current) return;
    rawRef.current = nextRaw;
    dirtyRef.current = true;
    setRaw(nextRaw);
    setSaveState("saving");
    if (timer.current) clearTimeout(timer.current);
    const pathAtSchedule = activePathRef.current;
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/file?path=${encodeURIComponent(pathAtSchedule)}`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(buildPayload(nextRaw)),
          },
        );
        if (activePathRef.current !== pathAtSchedule) return;
        if (res.status === 409) {
          setConflict(await res.json());
          setSaveState("conflict");
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as FileView;
        baseMtimeRef.current = data.mtime;
        dirtyRef.current = false;
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 600);
  };

  // ── Conflict resolution ──
  const reloadFromDisk = async () => {
    const path = activePathRef.current;
    if (!path) return;
    await loadFile(path);
  };

  const overrideSave = async () => {
    if (!conflict) return;
    baseMtimeRef.current = conflict.mtime;
    setConflict(null);
    scheduleSave(rawRef.current);
  };

  // ── File operations ──
  const createFile = async (name: string) => {
    try {
      const res = await fetch(`/api/file?path=${encodeURIComponent(name)}`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(`Gagal membuat file: ${data.error ?? res.status}`);
        return;
      }
      await refreshFileList();
      await switchFile(name);
    } catch (e) {
      alert(`Gagal membuat file: ${e}`);
    }
  };

  const deleteFile = async (path: string) => {
    try {
      const res = await fetch(`/api/file?path=${encodeURIComponent(path)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        alert(`Gagal menghapus file`);
        return;
      }
      const list = await refreshFileList();
      if (activePathRef.current === path) {
        activePathRef.current = null;
        setActivePath(null);
        rawRef.current = "";
        setRaw("");
        dirtyRef.current = false;
        if (list.length > 0) await loadFile(list[0].path);
      }
    } catch (e) {
      alert(`Gagal menghapus file: ${e}`);
    }
  };

  const renameFile = async (from: string, to: string) => {
    try {
      if (from === activePathRef.current && dirtyRef.current) {
        const ok = await flushSave();
        if (!ok) return;
      }
      const res = await fetch("/api/file/rename", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from, to }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(`Gagal rename: ${data.error ?? res.status}`);
        return;
      }
      await refreshFileList();
      if (activePathRef.current === from) {
        await loadFile(to);
      }
    } catch (e) {
      alert(`Gagal rename: ${e}`);
    }
  };

  // ── Task checkbox toggle ──
  const handleToggleTask = (lineIdx: number) => {
    const nextRaw = toggleTaskLine(rawRef.current, lineIdx);
    if (nextRaw !== rawRef.current) scheduleSave(nextRaw);
  };

  // ── Diagram modal handlers ──
  const openDiagram = (index: number) => {
    const blocks = findDiagramBlocks(rawRef.current);
    const loc = blocks[index];
    if (!loc) return;
    editingInitialRef.current = loc.content;
    editingDraftRef.current = loc.content;
    setEditingDiagram(index);
  };

  const closeDiagram = (save: boolean) => {
    const idx = editingDiagram;
    if (idx === null) {
      setEditingDiagram(null);
      return;
    }
    if (save && editingDraftRef.current !== editingInitialRef.current) {
      const nextRaw = spliceDiagramAt(
        rawRef.current,
        idx,
        editingDraftRef.current,
      );
      if (nextRaw !== rawRef.current) scheduleSave(nextRaw);
    }
    setEditingDiagram(null);
  };

  const insertNewDiagram = () => {
    const ta = textareaRef.current;
    const block = "```plan\n\n```\n";
    let nextRaw: string;
    let newBlockIndex: number;
    const before = rawRef.current;
    if (ta && document.activeElement === ta) {
      const pos = ta.selectionStart;
      // Ensure insertion starts at beginning of a line with blank padding
      const head = before.slice(0, pos);
      const tail = before.slice(pos);
      const leadNL = head.length === 0 || head.endsWith("\n\n") ? "" : head.endsWith("\n") ? "\n" : "\n\n";
      const trailNL = tail.startsWith("\n") || tail.length === 0 ? "\n" : "\n\n";
      nextRaw = head + leadNL + block + trailNL + tail;
    } else {
      const sep =
        before.length === 0
          ? ""
          : before.endsWith("\n\n")
            ? ""
            : before.endsWith("\n")
              ? "\n"
              : "\n\n";
      nextRaw = before + sep + block;
    }
    // Count diagram blocks up to where we inserted, new one is the last
    // added → its index = total blocks in nextRaw - 1 for append, or the
    // position in nextRaw's block order for mid-insert. Easiest: recount.
    scheduleSave(nextRaw);
    // Open the new block immediately. findDiagramBlocks on nextRaw gives
    // the correct index — find the first block whose content is "".
    const blocksAfter = findDiagramBlocks(nextRaw);
    // Prefer the block nearest the insertion position if there are
    // multiple empties — for simplicity, pick the last empty block.
    newBlockIndex = blocksAfter.length - 1;
    for (let i = blocksAfter.length - 1; i >= 0; i--) {
      if (blocksAfter[i].content === "") {
        newBlockIndex = i;
        break;
      }
    }
    // Defer open so state flushes first
    setTimeout(() => openDiagram(newBlockIndex), 0);
  };

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === "Escape" && editingDiagram !== null) {
        e.preventDefault();
        closeDiagram(true);
        return;
      }
      if (mod && e.key.toLowerCase() === "f" && !e.shiftKey) {
        e.preventDefault();
        openSearch();
        return;
      }
      if (mod && e.key.toLowerCase() === "b" && !e.shiftKey) {
        e.preventDefault();
        setSidebarCollapsed(c => !c);
      } else if (mod && e.key.toLowerCase() === "s" && !e.shiftKey) {
        e.preventDefault();
        flushSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingDiagram]);

  // ── Resizers ──
  const startResizeLeft = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev: MouseEvent) => {
      const next = startW + (ev.clientX - startX);
      setSidebarWidth(Math.max(160, Math.min(500, next)));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const splitClass = [
    "main-split",
    sidebarCollapsed ? "sidebar-collapsed" : "",
    "panel-hidden",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="app-canvas">
      <header className="header">
        <div className="title">
          <h1>plan</h1>
          <span className="path" title={absPath || workspaceCwd}>
            {activePath ?? workspaceCwd}
          </span>
        </div>
        <div className="header-actions">
          <button
            className="icon-btn"
            onClick={() => setSidebarCollapsed(c => !c)}
            title="Toggle file tree (⌘B)"
          >
            {sidebarCollapsed ? "Files ⟩" : "⟨ Files"}
          </button>
          {activePath && (
            <button
              className="icon-btn"
              onClick={insertNewDiagram}
              title="Sisipkan blok diagram baru"
            >
              + Diagram
            </button>
          )}
          <StatusBadge state={saveState} />
        </div>
      </header>

      {conflict && (
        <div className="conflict-banner">
          <span>
            File <code>{activePath}</code> berubah dari luar (mungkin oleh{" "}
            <code>plan</code> CLI atau editor lain). Perubahanmu di browser
            belum disimpan.
          </span>
          <div className="conflict-actions">
            <button className="icon-btn" onClick={reloadFromDisk}>
              Reload dari disk
            </button>
            <button className="icon-btn" onClick={overrideSave}>
              Timpa file
            </button>
          </div>
        </div>
      )}

      <div
        className={splitClass}
        style={{
          ["--sidebar-w" as any]: `${sidebarWidth}px`,
        }}
      >
        {!sidebarCollapsed && (
          <>
            <FileTree
              files={files}
              activePath={activePath}
              dirty={dirtyRef.current || saveState === "saving"}
              onOpen={switchFile}
              onCreate={createFile}
              onDelete={deleteFile}
              onRename={renameFile}
              onRefresh={() => refreshFileList()}
            />
            <div
              className="resizer"
              onMouseDown={startResizeLeft}
              title="Drag untuk ubah lebar sidebar"
            />
          </>
        )}

        <div className="main-canvas">
          {activePath ? (
            <div className="editor-wrap">
              {searchOpen && (
                <div className="search-bar">
                  <input
                    ref={searchInputRef}
                    className="search-input"
                    type="text"
                    value={searchQuery}
                    placeholder="Cari di file…"
                    onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        closeSearch();
                      } else if (e.key === "Enter") {
                        e.preventDefault();
                        advanceSearch(e.shiftKey ? -1 : 1);
                      }
                    }}
                  />
                  <span className="search-count">
                    {searchMatches.length === 0
                      ? searchQuery
                        ? "0/0"
                        : ""
                      : `${searchCursor + 1}/${searchMatches.length}`}
                  </span>
                  <button
                    className="search-btn"
                    onClick={() => advanceSearch(-1)}
                    title="Sebelumnya (Shift+Enter)"
                  >
                    ↑
                  </button>
                  <button
                    className="search-btn"
                    onClick={() => advanceSearch(1)}
                    title="Berikutnya (Enter)"
                  >
                    ↓
                  </button>
                  <button
                    className="search-btn"
                    onClick={closeSearch}
                    title="Tutup (Esc)"
                  >
                    ✕
                  </button>
                </div>
              )}
              <textarea
                key={activePath}
                ref={textareaRef}
                className="raw-editor"
                value={raw}
                spellCheck={false}
                onChange={e => scheduleSave(e.target.value)}
                onScroll={e =>
                  setEditorScrollTop((e.target as HTMLTextAreaElement).scrollTop)
                }
              />
              {editorMetrics.lineHeight > 0 &&
                taskLines.map(t => {
                  const top =
                    editorMetrics.paddingTop +
                    t.lineIdx * editorMetrics.lineHeight -
                    editorScrollTop;
                  if (
                    top < -editorMetrics.lineHeight ||
                    top > (textareaRef.current?.clientHeight ?? 0)
                  ) {
                    return null;
                  }
                  const left =
                    editorMetrics.paddingLeft +
                    t.bracketCol * editorMetrics.charWidth;
                  const width = editorMetrics.charWidth * 3;
                  return (
                    <button
                      key={`task-${t.lineIdx}`}
                      className={`task-checkbox${t.done ? " done" : ""}`}
                      style={{
                        top: `${top}px`,
                        left: `${left}px`,
                        width: `${width}px`,
                        height: `${editorMetrics.lineHeight}px`,
                      }}
                      onClick={() => handleToggleTask(t.lineIdx)}
                      title={t.done ? "Tandai belum selesai" : "Tandai selesai"}
                    >
                      {t.done ? "✓" : ""}
                    </button>
                  );
                })}
              {editorMetrics.lineHeight > 0 &&
                searchOpen &&
                searchQuery &&
                !searchQuery.includes("\n") &&
                searchMatchPositions.map((p, i) => {
                  const top =
                    editorMetrics.paddingTop +
                    p.line * editorMetrics.lineHeight -
                    editorScrollTop;
                  if (
                    top < -editorMetrics.lineHeight ||
                    top > (textareaRef.current?.clientHeight ?? 0)
                  ) {
                    return null;
                  }
                  const left =
                    editorMetrics.paddingLeft +
                    p.col * editorMetrics.charWidth;
                  const width = searchQuery.length * editorMetrics.charWidth;
                  const isCurrent = i === searchCursor;
                  return (
                    <div
                      key={`match-${i}`}
                      className={`search-hit${isCurrent ? " current" : ""}`}
                      style={{
                        top: `${top}px`,
                        left: `${left}px`,
                        width: `${width}px`,
                        height: `${editorMetrics.lineHeight}px`,
                      }}
                    />
                  );
                })}
              {editorMetrics.lineHeight > 0 &&
                diagramBlocks.map((b, i) => {
                  // Anchor one line ABOVE the fence so the button
                  // doesn't cover the ```plan text. Fall back to the
                  // fence line itself if the block starts at line 0.
                  const anchorLine = Math.max(0, b.openLineIdx - 1);
                  const top =
                    editorMetrics.paddingTop +
                    anchorLine * editorMetrics.lineHeight -
                    editorScrollTop;
                  // Hide if scrolled out of view (keeps DOM clean-ish)
                  if (
                    top < -editorMetrics.lineHeight ||
                    top > (textareaRef.current?.clientHeight ?? 0)
                  ) {
                    return null;
                  }
                  return (
                    <button
                      key={i}
                      className="diagram-float-btn"
                      style={{ top: `${top}px` }}
                      onClick={() => openDiagram(i)}
                      title={`Edit diagram (baris ${b.openLineIdx + 1})`}
                    >
                      ✎ edit
                    </button>
                  );
                })}
            </div>
          ) : (
            <div className="loading">
              {files.length === 0
                ? "Belum ada file — klik + di sidebar untuk membuat."
                : "Pilih file dari sidebar."}
            </div>
          )}
        </div>
      </div>

      {editingDiagram !== null && (
        <div className="diagram-modal">
          <div className="diagram-modal-header">
            <span>Edit diagram #{editingDiagram + 1}</span>
            <div className="header-actions">
              <button className="icon-btn" onClick={() => closeDiagram(false)}>
                Batal
              </button>
              <button className="icon-btn" onClick={() => closeDiagram(true)}>
                Done (Esc)
              </button>
            </div>
          </div>
          <div className="diagram-modal-body">
            <CanvasEditor
              initial={editingInitialRef.current}
              onChange={text => {
                editingDraftRef.current = text;
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ state }: { state: SaveState }) {
  const label = {
    idle: "",
    saving: "Menyimpan…",
    saved: "Tersimpan",
    error: "Gagal menyimpan",
    conflict: "Konflik",
  }[state];
  return <span className={`badge badge-${state}`}>{label}</span>;
}

export default App;
