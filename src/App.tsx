import { useEffect, useRef, useState } from "react";
import "./index.css";
import { CanvasEditor } from "./canvas/Canvas";
import { MetaPanel } from "./meta/MetaPanel";
import { FileTree, type FileEntry } from "./FileTree";
import type { PlanModel } from "./model";

type SaveState = "idle" | "saving" | "saved" | "error" | "conflict";

type FileView = {
  path: string;
  absPath: string;
  mtime: number;
  diagram: string;
  hasDiagram: boolean;
  hasStructure: boolean;
  sections: { context: string; scope: string; task: string; notes: string };
};

export function App() {
  // ── Workspace ──
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [workspaceCwd, setWorkspaceCwd] = useState("");

  // ── Active file state ──
  const [model, setModel] = useState<PlanModel | null>(null);
  const [initialDiagram, setInitialDiagram] = useState<string | null>(null);
  const [absPath, setAbsPath] = useState("");
  const [hasStructure, setHasStructure] = useState(false);

  // ── Save state ──
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [conflict, setConflict] = useState<null | FileView>(null);

  // ── Layout ──
  const [panelWidth, setPanelWidth] = useState(380);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // ── Refs ──
  const modelRef = useRef<PlanModel | null>(null);
  const hasStructureRef = useRef(false);
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
    const m: PlanModel = {
      diagram: view.diagram,
      context: view.sections.context,
      scope: view.sections.scope,
      task: view.sections.task,
      notes: view.sections.notes,
    };
    modelRef.current = m;
    baseMtimeRef.current = view.mtime;
    hasStructureRef.current = view.hasStructure;
    setModel(m);
    setInitialDiagram(view.diagram);
    setAbsPath(view.absPath);
    setHasStructure(view.hasStructure);
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

  const buildPayload = (m: PlanModel) => {
    // Always send diagram. Only send sections if file has plan structure
    // (otherwise the splice would be a noop anyway, but it's cleaner to
    //  not pretend we have data the server can't use).
    const payload: any = { diagram: m.diagram, baseMtime: baseMtimeRef.current };
    if (hasStructureRef.current) {
      payload.sections = {
        context: m.context,
        scope: m.scope,
        task: m.task,
        notes: m.notes,
      };
    }
    return payload;
  };

  const flushSave = async (): Promise<boolean> => {
    if (!dirtyRef.current || !modelRef.current || !activePathRef.current) {
      return true;
    }
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
        body: JSON.stringify(buildPayload(modelRef.current)),
      });
      if (res.status === 409) {
        setConflict(await res.json());
        setSaveState("conflict");
        return false;
      }
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as FileView;
      baseMtimeRef.current = data.mtime;
      hasStructureRef.current = data.hasStructure;
      setHasStructure(data.hasStructure);
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
  const scheduleSave = (next: PlanModel) => {
    if (!activePathRef.current) return;
    modelRef.current = next;
    dirtyRef.current = true;
    setModel(next);
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
            body: JSON.stringify(buildPayload(next)),
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
        hasStructureRef.current = data.hasStructure;
        setHasStructure(data.hasStructure);
        dirtyRef.current = false;
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 300);
  };

  // ── Conflict resolution ──
  const reloadFromDisk = async () => {
    const path = activePathRef.current;
    if (!path) return;
    await loadFile(path);
  };

  const overrideSave = async () => {
    if (!modelRef.current || !conflict) return;
    baseMtimeRef.current = conflict.mtime;
    setConflict(null);
    scheduleSave(modelRef.current);
  };

  // ── Edit handlers ──
  const handleDiagramChange = (diagram: string) => {
    if (!modelRef.current) return;
    scheduleSave({ ...modelRef.current, diagram });
  };

  const handleMetaChange = (next: PlanModel) => {
    scheduleSave(next);
  };

  // ── Plan structure activation ──
  const enablePlanStructure = async () => {
    const path = activePathRef.current;
    if (!path) return;
    // Flush any pending edits first so we don't race
    if (dirtyRef.current) {
      const ok = await flushSave();
      if (!ok) return;
    }
    try {
      const res = await fetch(
        `/api/file/scaffold?path=${encodeURIComponent(path)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ baseMtime: baseMtimeRef.current }),
        },
      );
      if (res.status === 409) {
        setConflict(await res.json());
        setSaveState("conflict");
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      applyView(await res.json());
    } catch {
      setSaveState("error");
    }
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
        modelRef.current = null;
        setModel(null);
        setInitialDiagram(null);
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

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        setPanelCollapsed(c => !c);
      } else if (mod && e.key.toLowerCase() === "b" && !e.shiftKey) {
        e.preventDefault();
        setSidebarCollapsed(c => !c);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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

  const startResizeRight = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panelWidth;
    const onMove = (ev: MouseEvent) => {
      const next = startW + (startX - ev.clientX);
      setPanelWidth(Math.max(280, Math.min(720, next)));
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
    panelCollapsed ? "collapsed" : "",
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
          <button
            className="icon-btn"
            onClick={() => setPanelCollapsed(c => !c)}
            title="Toggle meta panel (⌘⇧M)"
          >
            {panelCollapsed ? "⟨ Panel" : "Panel ⟩"}
          </button>
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
          ["--panel-w" as any]: `${panelWidth}px`,
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
          {model && initialDiagram !== null && activePath ? (
            <CanvasEditor
              key={activePath}
              initial={initialDiagram}
              onChange={handleDiagramChange}
            />
          ) : (
            <div className="loading">
              {files.length === 0
                ? "Belum ada file — klik + di sidebar untuk membuat."
                : "Pilih file dari sidebar."}
            </div>
          )}
        </div>

        {!panelCollapsed && activePath && (
          <>
            <div
              className="resizer"
              onMouseDown={startResizeRight}
              title="Drag untuk ubah lebar panel"
            />
            {hasStructure && model ? (
              <MetaPanel
                key={activePath}
                model={model}
                onChange={handleMetaChange}
              />
            ) : (
              <aside className="meta-panel meta-panel-disabled">
                <div className="meta-disabled-card">
                  <div className="meta-disabled-title">
                    Plan structure belum aktif
                  </div>
                  <p className="meta-disabled-body">
                    File ini hanya menyimpan diagram. Aktifkan untuk menambahkan
                    section <code>Context</code>, <code>Scope</code>,{" "}
                    <code>Task</code>, dan <code>Notes</code> ke akhir file.
                    Konten yang sudah ada tidak akan diubah.
                  </p>
                  <button className="icon-btn" onClick={enablePlanStructure}>
                    Aktifkan plan structure
                  </button>
                </div>
              </aside>
            )}
          </>
        )}
      </div>
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
