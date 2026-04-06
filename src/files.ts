import { readdir, stat } from "node:fs/promises";
import { join, resolve, relative, sep } from "node:path";

/**
 * Workspace file discovery + path validation.
 *
 * - Scans cwd recursively for `.md` files.
 * - Skips hardcoded noise dirs + any dotfile/dotdir.
 * - `resolveWorkspacePath` validates a client-supplied relative path and
 *   guarantees the resolved absolute path stays under `cwd` (no traversal).
 */

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  "out",
  ".next",
  ".cache",
  ".turbo",
  ".vscode",
  ".idea",
  "coverage",
  "target",
]);

export type FileEntry = { path: string; mtime: number };

export async function listMarkdownFiles(cwd: string): Promise<FileEntry[]> {
  const root = resolve(cwd);
  const out: FileEntry[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      // Skip hidden + noise dirs unconditionally
      if (e.name.startsWith(".")) continue;
      if (SKIP_DIRS.has(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
        try {
          const s = await stat(full);
          out.push({
            path: relative(root, full).split(sep).join("/"),
            mtime: s.mtimeMs,
          });
        } catch {
          // ignore unreadable entries
        }
      }
    }
  }

  await walk(root);
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

/**
 * Validate and resolve a relative markdown path against cwd.
 * Returns absolute path, or null if rejected.
 */
export function resolveWorkspacePath(cwd: string, rel: string): string | null {
  if (typeof rel !== "string" || rel.length === 0) return null;
  if (rel.includes("\0")) return null;
  const normalized = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized.toLowerCase().endsWith(".md")) return null;
  // Explicit `..` segment guard (defense in depth; resolve() also handles it)
  if (/(^|\/)\.\.(\/|$)/.test(normalized)) return null;

  const root = resolve(cwd);
  const abs = resolve(root, normalized);
  const relCheck = relative(root, abs);
  if (!relCheck || relCheck.startsWith("..") || relCheck === "") return null;
  return abs;
}

