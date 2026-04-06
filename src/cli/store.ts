import { resolve, dirname } from "node:path";
import { mkdir } from "node:fs/promises";

const DEFAULT_FILE = "PLAN.md";

export function planPath(cwd: string, file: string = DEFAULT_FILE): string {
  return resolve(cwd, file);
}

export async function readRaw(
  cwd: string,
  file: string = DEFAULT_FILE,
): Promise<string> {
  const path = planPath(cwd, file);
  const f = Bun.file(path);
  if (!(await f.exists())) return "";
  return await f.text();
}

export async function writeRaw(
  cwd: string,
  raw: string,
  file: string = DEFAULT_FILE,
): Promise<void> {
  const path = planPath(cwd, file);
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, raw);
}
