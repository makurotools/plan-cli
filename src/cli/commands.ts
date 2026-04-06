import { readRaw, writeRaw, planPath } from "./store";
import { parseTasks, serializeTasks, type Task } from "../tasks";
import { renderStatus, renderTasks, errorLine } from "./render";
import {
  extractPlanView,
  findSection,
  spliceSection,
  scaffoldPlanStructure,
  hasPlanStructure,
} from "../planFile";
import { listMarkdownFiles } from "../files";

export type Ctx = { cwd: string; file: string };

function requireTaskSection(raw: string, ctx: Ctx): string {
  const loc = findSection(raw, "task");
  if (!loc.exists) {
    const flag = ctx.file === "PLAN.md" ? "" : ` -f ${ctx.file}`;
    console.error(
      errorLine(
        `file "${ctx.file}" belum pakai plan structure. Jalankan: plan init${flag}`,
      ),
    );
    process.exit(1);
  }
  return loc.content;
}

async function mutateTasks(
  ctx: Ctx,
  fn: (tasks: Task[]) => Task[],
): Promise<void> {
  const raw = await readRaw(ctx.cwd, ctx.file);
  const taskText = requireTaskSection(raw, ctx);
  const tasks = fn(parseTasks(taskText));
  const newText = serializeTasks(tasks);
  const nextRaw = spliceSection(raw, "task", newText);
  if (nextRaw !== raw) await writeRaw(ctx.cwd, nextRaw, ctx.file);
  console.log(renderTasks(newText));
}

function parseIndex(arg: string | undefined, len: number): number | null {
  if (!arg) return null;
  const n = Number.parseInt(arg, 10);
  if (!Number.isFinite(n) || n < 1 || n > len) return null;
  return n - 1;
}

export async function cmdStatus(ctx: Ctx): Promise<void> {
  const raw = await readRaw(ctx.cwd, ctx.file);
  const view = extractPlanView(raw);
  console.log(renderStatus(view, planPath(ctx.cwd, ctx.file)));
}

export async function cmdTasks(ctx: Ctx): Promise<void> {
  const raw = await readRaw(ctx.cwd, ctx.file);
  const loc = findSection(raw, "task");
  if (!loc.exists) {
    const flag = ctx.file === "PLAN.md" ? "" : ` -f ${ctx.file}`;
    console.log(
      `(file belum pakai plan structure — jalankan 'plan init${flag}')`,
    );
    return;
  }
  console.log(renderTasks(loc.content));
}

export async function cmdDone(ctx: Ctx, args: string[]): Promise<void> {
  await mutateTasks(ctx, tasks => {
    const idx = parseIndex(args[0], tasks.length);
    if (idx === null) {
      console.error(errorLine(`nomor task tidak valid: ${args[0] ?? "(kosong)"}`));
      process.exit(1);
    }
    return tasks.map((t, i) => (i === idx ? { ...t, done: true } : t));
  });
}

export async function cmdUndone(ctx: Ctx, args: string[]): Promise<void> {
  await mutateTasks(ctx, tasks => {
    const idx = parseIndex(args[0], tasks.length);
    if (idx === null) {
      console.error(errorLine(`nomor task tidak valid: ${args[0] ?? "(kosong)"}`));
      process.exit(1);
    }
    return tasks.map((t, i) => (i === idx ? { ...t, done: false } : t));
  });
}

export async function cmdAdd(ctx: Ctx, args: string[]): Promise<void> {
  const text = args.join(" ").trim();
  if (!text) {
    console.error(errorLine("teks task kosong"));
    process.exit(1);
  }
  await mutateTasks(ctx, tasks => [...tasks, { done: false, text }]);
}

export async function cmdRemove(ctx: Ctx, args: string[]): Promise<void> {
  await mutateTasks(ctx, tasks => {
    const idx = parseIndex(args[0], tasks.length);
    if (idx === null) {
      console.error(errorLine(`nomor task tidak valid: ${args[0] ?? "(kosong)"}`));
      process.exit(1);
    }
    return tasks.filter((_, i) => i !== idx);
  });
}

export async function cmdEdit(ctx: Ctx, args: string[]): Promise<void> {
  await mutateTasks(ctx, tasks => {
    const idx = parseIndex(args[0], tasks.length);
    if (idx === null) {
      console.error(errorLine(`nomor task tidak valid: ${args[0] ?? "(kosong)"}`));
      process.exit(1);
    }
    const text = args.slice(1).join(" ").trim();
    if (!text) {
      console.error(errorLine("teks task kosong"));
      process.exit(1);
    }
    return tasks.map((t, i) => (i === idx ? { ...t, text } : t));
  });
}

export async function cmdInit(ctx: Ctx): Promise<void> {
  const raw = await readRaw(ctx.cwd, ctx.file);
  if (hasPlanStructure(raw)) {
    // Still ensure all four sections exist (idempotent)
    const scaffolded = scaffoldPlanStructure(raw);
    if (scaffolded === raw) {
      console.log(`${ctx.file}: sudah pakai plan structure lengkap`);
      return;
    }
    await writeRaw(ctx.cwd, scaffolded, ctx.file);
    console.log(`${ctx.file}: section yang hilang ditambahkan`);
    return;
  }
  const scaffolded = scaffoldPlanStructure(raw);
  await writeRaw(ctx.cwd, scaffolded, ctx.file);
  console.log(`${ctx.file}: plan structure ditambahkan`);
}

export async function cmdList(ctx: Ctx): Promise<void> {
  const files = await listMarkdownFiles(ctx.cwd);
  if (files.length === 0) {
    console.log("(belum ada file .md di workspace ini)");
    return;
  }
  for (const f of files) console.log(f.path);
}
