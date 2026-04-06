#!/usr/bin/env bun
import { resolve } from "node:path";
import { startServer } from "./src/server";
import {
  cmdStatus,
  cmdTasks,
  cmdDone,
  cmdUndone,
  cmdAdd,
  cmdRemove,
  cmdEdit,
  cmdList,
  cmdInit,
} from "./src/cli/commands";

const DEFAULT_FILE = "PLAN.md";

// Parse args: support `--file <path>` / `-f <path>` anywhere in argv.
function parseArgs(argv: string[]): { file: string; positional: string[] } {
  let file = DEFAULT_FILE;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file" || a === "-f") {
      const next = argv[i + 1];
      if (!next) {
        console.error("plan: --file butuh argumen path");
        process.exit(1);
      }
      file = next;
      i++;
    } else if (a.startsWith("--file=")) {
      file = a.slice("--file=".length);
    } else {
      positional.push(a);
    }
  }
  return { file, positional };
}

function printHelp() {
  console.log(`plan — planning layer antara otakmu dan Claude Code

Penggunaan:
  plan                    Buka editor workspace di browser
  plan ls                 Daftar semua file .md di workspace
  plan init               Tambah plan structure (Context/Scope/Task/Notes)
                          ke file target. Idempoten, non-destruktif.
  plan path               Cetak path absolut file aktif (default ${DEFAULT_FILE})
  plan status             Ringkasan plan file (konteks, scope, task, catatan)
  plan tasks              Daftar task saja
  plan done <n>           Tandai task nomor <n> selesai
  plan undone <n>         Tandai task nomor <n> belum selesai
  plan add <teks...>      Tambah task baru
  plan rm <n>             Hapus task nomor <n>
  plan edit <n> <teks>    Ubah teks task nomor <n>
  plan --help             Tampilkan bantuan ini

Opsi:
  -f, --file <path>       File target (default ${DEFAULT_FILE}).
                          Path relatif terhadap cwd, harus .md.

Contoh:
  plan status
  plan status -f docs/roadmap.md
  plan done 3 --file sprints/2026-w14.md
`);
}

async function openBrowser(url: string) {
  const cmd = process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "start"
    : "xdg-open";
  try {
    await Bun.$`${cmd} ${url}`.quiet();
  } catch {
    // silent — URL tetap dicetak ke terminal
  }
}

async function main() {
  const { file, positional } = parseArgs(process.argv.slice(2));
  const cmd = positional[0];

  if (cmd === "--help" || cmd === "-h" || cmd === "help") {
    printHelp();
    return;
  }

  if (cmd === "path") {
    console.log(resolve(process.cwd(), file));
    return;
  }

  const ctx = { cwd: process.cwd(), file };
  const rest = positional.slice(1);
  switch (cmd) {
    case "status": await cmdStatus(ctx); return;
    case "tasks": await cmdTasks(ctx); return;
    case "done": await cmdDone(ctx, rest); return;
    case "undone": await cmdUndone(ctx, rest); return;
    case "add": await cmdAdd(ctx, rest); return;
    case "rm":
    case "remove": await cmdRemove(ctx, rest); return;
    case "edit": await cmdEdit(ctx, rest); return;
    case "ls":
    case "list": await cmdList(ctx); return;
    case "init": await cmdInit(ctx); return;
  }

  if (cmd && cmd !== "") {
    console.error(`plan: perintah tidak dikenal: ${cmd}`);
    printHelp();
    process.exit(1);
  }

  const server = startServer({
    cwd: process.cwd(),
    dev: process.env.NODE_ENV !== "production",
  });

  const url = server.url.toString().replace(/\/$/, "");
  console.log(`\n  plan editor siap`);
  console.log(`  workspace : ${process.cwd()}`);
  console.log(`  url       : ${url}`);
  console.log(`\n  Tekan Ctrl+C untuk keluar.\n`);

  await openBrowser(url);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
