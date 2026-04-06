# @malikkurosaki/plan-cli

Planning layer antara otakmu dan Claude Code — markdown editor + ASCII diagram canvas + CLI, powered by Bun.

`plan` adalah CLI + editor web untuk markdown workspace kamu. Edit file `.md` langsung di browser, gambar ASCII diagram di dalam fenced block (` ```plan `), toggle task checkbox, dan kelola semuanya dari terminal — semua tanpa merusak byte di luar area yang kamu edit.

## Install

```sh
bun install -g @malikkurosaki/plan-cli
```

Atau jalankan langsung tanpa install:

```sh
bunx @malikkurosaki/plan-cli
```

## Pemakaian

```sh
plan                      # buka editor workspace di browser
plan ls                   # daftar semua file .md di workspace
plan status               # ringkasan plan file (konteks/scope/task/notes)
plan tasks                # daftar task
plan done <n>             # tandai task ke-n selesai
plan add "teks task"      # tambah task baru
plan init                 # scaffold ## Context/Scope/Task/Notes
plan --help               # bantuan lengkap
```

### Opsi

| Flag | Keterangan |
|---|---|
| `-f, --file <path>` | File target (default `PLAN.md`) |
| `-p, --port <n>` | Pin port editor. Auto-open browser dimatikan supaya kamu bisa reattach ke tab lama |
| `--no-open` | Jangan auto-buka browser saat start editor |
| `-h, --help` | Tampilkan bantuan |

## Editor web — shortcut

| Shortcut | Aksi |
|---|---|
| `⌘S` | Simpan |
| `⌘F` | Cari dalam file |
| `⌘\` | Toggle preview markdown |
| `⌘B` | Toggle file tree |
| `⌘/` atau `?` | Cheatsheet shortcut |

Di dalam editor, tiap fenced block ` ```plan ` / ` ```diagram ` / ` ```ascii ` punya tombol **edit** kecil di kiri atas untuk buka canvas ASCII. Task `- [ ]` bisa di-toggle langsung dengan klik.

## Filosofi

- **Non-destruktif** — buka file, tidak mengetik apapun, simpan → file byte-identical.
- **Splice-based** — edit hanya memutasi rentang byte yang berubah (diagram block, atau section yang sedang diedit). Tidak ada reformat global.
- **Lazy-create** — diagram block / section heading hanya ditambahkan kalau kamu benar-benar menulis isinya.

## Development

```sh
bun install
bun run dev       # jalankan dari source
bun test          # run unit tests (splice ops, fence detection, dll)
```

## License

MIT
