import { serve } from "bun";
import { mkdir, unlink, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import index from "./index.html";
import { listMarkdownFiles, resolveWorkspacePath } from "./files";
import {
  applyPatch,
  extractPlanView,
  scaffoldPlanStructure,
  type PlanPatch,
} from "./planFile";

export type StartServerOptions = {
  cwd: string;
  port?: number;
  dev?: boolean;
};

export function startServer(opts: StartServerOptions) {
  const cwd = resolve(opts.cwd);

  const getMtime = async (abs: string): Promise<number> => {
    const f = Bun.file(abs);
    if (!(await f.exists())) return 0;
    return f.lastModified;
  };

  const readRaw = async (abs: string): Promise<{ raw: string; mtime: number; exists: boolean }> => {
    const f = Bun.file(abs);
    if (!(await f.exists())) return { raw: "", mtime: 0, exists: false };
    return { raw: await f.text(), mtime: f.lastModified, exists: true };
  };

  const writeRaw = async (abs: string, raw: string): Promise<number> => {
    await mkdir(dirname(abs), { recursive: true });
    await Bun.write(abs, raw);
    return getMtime(abs);
  };

  const buildView = (path: string, abs: string, raw: string, mtime: number) => ({
    path,
    absPath: abs,
    mtime,
    raw,
    ...extractPlanView(raw),
  });

  const badPath = () =>
    Response.json({ error: "invalid path" }, { status: 400 });

  const resolveFromQuery = (req: Request): { abs: string; rel: string } | Response => {
    const url = new URL(req.url);
    const p = url.searchParams.get("path");
    if (!p) return badPath();
    const abs = resolveWorkspacePath(cwd, p);
    if (!abs) return badPath();
    return { abs, rel: p };
  };

  // Port random di range ephemeral — hindari port 0 (bug Bun EADDRINUSE)
  // dan default port 3000 yang sering bentrok.
  const port = opts.port ?? 20000 + Math.floor(Math.random() * 40000);

  return serve({
    port,
    development: opts.dev ? { hmr: true, console: true } : false,
    routes: {
      "/*": index,

      // ── Workspace listing ──────────────────────────────────────
      "/api/files": {
        async GET() {
          try {
            const files = await listMarkdownFiles(cwd);
            return Response.json({ cwd, files });
          } catch (err) {
            return Response.json({ error: String(err) }, { status: 500 });
          }
        },
      },

      // ── Single file read / write ───────────────────────────────
      "/api/file": {
        async GET(req) {
          const r = resolveFromQuery(req);
          if (r instanceof Response) return r;
          try {
            const { raw, mtime } = await readRaw(r.abs);
            return Response.json(buildView(r.rel, r.abs, raw, mtime));
          } catch (err) {
            return Response.json({ error: String(err) }, { status: 500 });
          }
        },
        async PUT(req) {
          const r = resolveFromQuery(req);
          if (r instanceof Response) return r;
          try {
            const body = (await req.json()) as PlanPatch & {
              raw?: string;
              baseMtime?: number;
            };
            // Read current state
            const current = await readRaw(r.abs);
            if (current.exists && typeof body.baseMtime === "number") {
              if (current.mtime !== body.baseMtime) {
                return Response.json(
                  {
                    error: "conflict",
                    ...buildView(r.rel, r.abs, current.raw, current.mtime),
                  },
                  { status: 409 },
                );
              }
            }
            // Two write modes:
            //  - raw: whole-file replace (browser full editor)
            //  - patch: splice diagram/sections (CLI + legacy)
            const nextRaw =
              typeof body.raw === "string"
                ? body.raw
                : applyPatch(current.raw, {
                    diagram: body.diagram,
                    sections: body.sections,
                  });
            // Byte-identical → skip the actual file write, keep mtime stable
            if (nextRaw === current.raw) {
              return Response.json({
                ok: true,
                ...buildView(r.rel, r.abs, current.raw, current.mtime),
              });
            }
            const mtime = await writeRaw(r.abs, nextRaw);
            return Response.json({
              ok: true,
              ...buildView(r.rel, r.abs, nextRaw, mtime),
            });
          } catch (err) {
            return Response.json({ error: String(err) }, { status: 500 });
          }
        },
        async POST(req) {
          // Create new empty file
          const r = resolveFromQuery(req);
          if (r instanceof Response) return r;
          try {
            const file = Bun.file(r.abs);
            if (await file.exists()) {
              return Response.json({ error: "file exists" }, { status: 409 });
            }
            await mkdir(dirname(r.abs), { recursive: true });
            await Bun.write(r.abs, "");
            return Response.json({ ok: true, mtime: await getMtime(r.abs) });
          } catch (err) {
            return Response.json({ error: String(err) }, { status: 500 });
          }
        },
        async DELETE(req) {
          const r = resolveFromQuery(req);
          if (r instanceof Response) return r;
          try {
            await unlink(r.abs);
            return Response.json({ ok: true });
          } catch (err) {
            return Response.json({ error: String(err) }, { status: 500 });
          }
        },
      },

      "/api/file/mtime": {
        async GET(req) {
          const r = resolveFromQuery(req);
          if (r instanceof Response) return r;
          return Response.json({ mtime: await getMtime(r.abs) });
        },
      },

      "/api/file/scaffold": {
        async POST(req) {
          const r = resolveFromQuery(req);
          if (r instanceof Response) return r;
          try {
            const body = (await req.json().catch(() => ({}))) as {
              baseMtime?: number;
            };
            const current = await readRaw(r.abs);
            if (current.exists && typeof body.baseMtime === "number") {
              if (current.mtime !== body.baseMtime) {
                return Response.json(
                  {
                    error: "conflict",
                    ...buildView(r.rel, r.abs, current.raw, current.mtime),
                  },
                  { status: 409 },
                );
              }
            }
            const nextRaw = scaffoldPlanStructure(current.raw);
            if (nextRaw === current.raw) {
              return Response.json({
                ok: true,
                ...buildView(r.rel, r.abs, current.raw, current.mtime),
              });
            }
            const mtime = await writeRaw(r.abs, nextRaw);
            return Response.json({
              ok: true,
              ...buildView(r.rel, r.abs, nextRaw, mtime),
            });
          } catch (err) {
            return Response.json({ error: String(err) }, { status: 500 });
          }
        },
      },

      "/api/file/rename": {
        async POST(req) {
          try {
            const body = (await req.json()) as { from?: string; to?: string };
            if (!body?.from || !body?.to) return badPath();
            const fromAbs = resolveWorkspacePath(cwd, body.from);
            const toAbs = resolveWorkspacePath(cwd, body.to);
            if (!fromAbs || !toAbs) return badPath();
            if (fromAbs === toAbs) {
              return Response.json({ ok: true, mtime: await getMtime(fromAbs) });
            }
            const toFile = Bun.file(toAbs);
            if (await toFile.exists()) {
              return Response.json(
                { error: "target exists" },
                { status: 409 },
              );
            }
            await mkdir(dirname(toAbs), { recursive: true });
            await rename(fromAbs, toAbs);
            return Response.json({ ok: true, mtime: await getMtime(toAbs) });
          } catch (err) {
            return Response.json({ error: String(err) }, { status: 500 });
          }
        },
      },
    },
  });
}
