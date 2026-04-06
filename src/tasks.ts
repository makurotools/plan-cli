/**
 * Pure parser/serializer untuk section Task — dipakai oleh UI (TaskList)
 * dan CLI (plan done/undone/add/rm). Tidak boleh import React.
 */

export type Task = { done: boolean; text: string };

export function parseTasks(src: string): Task[] {
  if (!src) return [];
  const out: Task[] = [];
  for (const line of src.split(/\r?\n/)) {
    const m = line.match(/^\s*-\s*\[([ xX])\]\s*(.*)$/);
    if (m) {
      out.push({
        done: m[1].toLowerCase() === "x",
        text: m[2],
      });
    }
  }
  return out;
}

export function serializeTasks(items: Task[]): string {
  if (items.length === 0) return "";
  return items
    .map(i => `- [${i.done ? "x" : " "}] ${i.text}`)
    .join("\n");
}
