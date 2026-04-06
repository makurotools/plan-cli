import { useEffect, useRef, useState } from "react";
import { parseTasks as parsePure, serializeTasks as serializePure } from "../tasks";

export type TaskItem = { id: string; done: boolean; text: string };

let _idCounter = 0;
const newId = () => `t-${Date.now().toString(36)}-${++_idCounter}`;

function parseWithIds(src: string): TaskItem[] {
  return parsePure(src).map(t => ({ ...t, id: newId() }));
}

function serializeItems(items: TaskItem[]): string {
  return serializePure(items.map(({ done, text }) => ({ done, text })));
}

type Props = {
  initial: string;
  onChange: (serialized: string) => void;
};

export function TaskList({ initial, onChange }: Props) {
  const [items, setItems] = useState<TaskItem[]>(() => parseWithIds(initial));
  const initRef = useRef(false);
  const inputsRef = useRef<Record<string, HTMLInputElement | null>>({});
  const pendingFocus = useRef<string | null>(null);

  // Hydrate from initial exactly once.
  useEffect(() => {
    if (!initRef.current && initial) {
      setItems(parseWithIds(initial));
      initRef.current = true;
    } else if (!initRef.current) {
      initRef.current = true;
    }
  }, [initial]);

  useEffect(() => {
    if (pendingFocus.current) {
      const el = inputsRef.current[pendingFocus.current];
      el?.focus();
      pendingFocus.current = null;
    }
  });

  const update = (next: TaskItem[]) => {
    setItems(next);
    onChange(serializeItems(next));
  };

  const toggle = (id: string) => {
    update(items.map(i => (i.id === id ? { ...i, done: !i.done } : i)));
  };

  const setText = (id: string, text: string) => {
    update(items.map(i => (i.id === id ? { ...i, text } : i)));
  };

  const addTask = (afterId?: string) => {
    const nt: TaskItem = { id: newId(), done: false, text: "" };
    pendingFocus.current = nt.id;
    if (!afterId) {
      update([...items, nt]);
      return;
    }
    const idx = items.findIndex(i => i.id === afterId);
    if (idx === -1) {
      update([...items, nt]);
      return;
    }
    update([...items.slice(0, idx + 1), nt, ...items.slice(idx + 1)]);
  };

  const removeTask = (id: string) => {
    const idx = items.findIndex(i => i.id === id);
    if (idx === -1) return;
    const next = items.filter(i => i.id !== id);
    // Focus previous if any
    const prev = next[idx - 1] ?? next[idx];
    if (prev) pendingFocus.current = prev.id;
    update(next);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, item: TaskItem) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTask(item.id);
    } else if (e.key === "Backspace" && item.text === "") {
      e.preventDefault();
      removeTask(item.id);
    }
  };

  return (
    <div className="tasklist">
      {items.length === 0 && (
        <div className="tasklist-empty">Belum ada task</div>
      )}
      {items.map(item => (
        <div
          key={item.id}
          className={item.done ? "task done" : "task"}
        >
          <button
            className="task-check"
            onClick={() => toggle(item.id)}
            aria-label={item.done ? "Tandai belum selesai" : "Tandai selesai"}
          >
            {item.done ? "✓" : ""}
          </button>
          <input
            ref={el => {
              inputsRef.current[item.id] = el;
            }}
            className="task-text"
            type="text"
            value={item.text}
            placeholder="Deskripsi task…"
            onChange={e => setText(item.id, e.target.value)}
            onKeyDown={e => onKeyDown(e, item)}
            spellCheck={false}
          />
          <button
            className="task-remove"
            onClick={() => removeTask(item.id)}
            title="Hapus task"
            tabIndex={-1}
          >
            ×
          </button>
        </div>
      ))}
      <button className="task-add" onClick={() => addTask()}>
        + Tambah task
      </button>
    </div>
  );
}
