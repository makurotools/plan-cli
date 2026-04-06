import { useState } from "react";

export type FileEntry = { path: string; mtime: number };

type Props = {
  files: FileEntry[];
  activePath: string | null;
  dirty: boolean;
  onOpen: (path: string) => void;
  onCreate: (name: string) => void;
  onDelete: (path: string) => void;
  onRename: (from: string, to: string) => void;
  onRefresh: () => void;
};

export function FileTree({
  files,
  activePath,
  dirty,
  onOpen,
  onCreate,
  onDelete,
  onRename,
  onRefresh,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const normalize = (name: string): string => {
    const trimmed = name.trim().replace(/^\/+/, "");
    if (!trimmed) return "";
    return trimmed.toLowerCase().endsWith(".md") ? trimmed : `${trimmed}.md`;
  };

  const submitCreate = () => {
    const final = normalize(draft);
    setCreating(false);
    setDraft("");
    if (final) onCreate(final);
  };

  const submitRename = (from: string) => {
    const final = normalize(renameDraft);
    setRenaming(null);
    if (final && final !== from) onRename(from, final);
  };

  return (
    <aside className="file-tree">
      <div className="file-tree-header">
        <span className="file-tree-title">FILES</span>
        <div className="file-tree-header-actions">
          <button
            className="icon-btn"
            onClick={() => setCreating(true)}
            title="Buat file baru"
          >
            +
          </button>
          <button
            className="icon-btn"
            onClick={onRefresh}
            title="Muat ulang daftar"
          >
            ↻
          </button>
        </div>
      </div>
      <div className="file-tree-list">
        {creating && (
          <div className="file-tree-item creating">
            <input
              autoFocus
              className="file-tree-input"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onBlur={submitCreate}
              onKeyDown={e => {
                if (e.key === "Enter") submitCreate();
                else if (e.key === "Escape") {
                  setCreating(false);
                  setDraft("");
                }
              }}
              placeholder="nama-file.md"
            />
          </div>
        )}
        {files.length === 0 && !creating && (
          <div className="file-tree-empty">Belum ada file .md</div>
        )}
        {files.map(f => {
          const isActive = activePath === f.path;
          const isRenaming = renaming === f.path;
          return (
            <div
              key={f.path}
              className={`file-tree-item${isActive ? " active" : ""}`}
              onClick={() => !isRenaming && onOpen(f.path)}
              title={f.path}
            >
              {isRenaming ? (
                <input
                  autoFocus
                  className="file-tree-input"
                  value={renameDraft}
                  onChange={e => setRenameDraft(e.target.value)}
                  onBlur={() => submitRename(f.path)}
                  onKeyDown={e => {
                    if (e.key === "Enter") submitRename(f.path);
                    else if (e.key === "Escape") setRenaming(null);
                  }}
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <>
                  <span className="file-tree-name">
                    {f.path}
                    {isActive && dirty && (
                      <span className="file-tree-dirty" title="Belum tersimpan">
                        {" "}
                        •
                      </span>
                    )}
                  </span>
                  <span className="file-tree-row-actions">
                    <button
                      className="icon-btn"
                      onClick={e => {
                        e.stopPropagation();
                        setRenaming(f.path);
                        setRenameDraft(f.path);
                      }}
                      title="Rename"
                    >
                      ✎
                    </button>
                    <button
                      className="icon-btn danger-btn"
                      onClick={e => {
                        e.stopPropagation();
                        if (confirm(`Hapus ${f.path}?`)) onDelete(f.path);
                      }}
                      title="Hapus"
                    >
                      ✕
                    </button>
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
