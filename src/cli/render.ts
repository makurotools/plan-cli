import type { PlanView } from "../planFile";
import { parseTasks } from "../tasks";

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const ACCENT = "\x1b[33m";
const RED = "\x1b[31m";

function section(label: string, body: string): string {
  if (!body.trim()) return `${DIM}${label}: (kosong)${RESET}`;
  const lines = body.split(/\r?\n/).map(l => `  ${l}`).join("\n");
  return `${BOLD}${label}${RESET}\n${lines}`;
}

export function renderTasks(taskText: string): string {
  const tasks = parseTasks(taskText);
  if (tasks.length === 0) return `${DIM}(belum ada task)${RESET}`;
  const done = tasks.filter(t => t.done).length;
  const header = `${BOLD}Task${RESET} ${DIM}${done}/${tasks.length}${RESET}`;
  const lines = tasks.map((t, i) => {
    const n = String(i + 1).padStart(2, " ");
    if (t.done) {
      return `  ${DIM}${n}. ${GREEN}✓${RESET}${DIM} ${t.text}${RESET}`;
    }
    return `  ${n}. ${ACCENT}○${RESET} ${t.text}`;
  });
  return `${header}\n${lines.join("\n")}`;
}

export function renderStatus(view: PlanView, path: string): string {
  const parts: string[] = [];
  parts.push(`${BOLD}${ACCENT}plan${RESET} ${DIM}${path}${RESET}`);
  if (!view.hasStructure && !view.hasDiagram) {
    parts.push("");
    parts.push(
      `${DIM}(file belum pakai plan structure — jalankan 'plan init' untuk menambahkan)${RESET}`,
    );
    return parts.join("\n");
  }
  if (view.hasStructure) {
    parts.push("");
    parts.push(section("Konteks", view.sections.context));
    parts.push("");
    parts.push(section("Scope", view.sections.scope));
    parts.push("");
    parts.push(renderTasks(view.sections.task));
    if (view.sections.notes.trim()) {
      parts.push("");
      parts.push(section("Catatan", view.sections.notes));
    }
  }
  if (view.hasDiagram) {
    parts.push("");
    parts.push(`${DIM}(diagram: ${view.diagram.split("\n").length} baris)${RESET}`);
  }
  return parts.join("\n");
}

export function errorLine(msg: string): string {
  return `${RED}plan:${RESET} ${msg}`;
}
