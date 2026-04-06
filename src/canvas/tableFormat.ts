/**
 * Parse teks tabular (TSV atau CSV sederhana) dan render jadi ASCII table
 * dengan kolom auto-align. Baris pertama dianggap header dan dipisah dengan
 * divider.
 */

export function parseTabular(text: string): string[][] | null {
  const raw = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd();
  if (!raw) return null;
  const lines = raw.split("\n").filter(l => l.length > 0);
  if (lines.length === 0) return null;

  // Prefer tabs
  if (lines[0].includes("\t")) {
    return lines.map(l => l.split("\t"));
  }
  // CSV fallback — require >=2 commas on the first line and consistent count
  const firstCommas = (lines[0].match(/,/g) ?? []).length;
  if (firstCommas >= 1) {
    const consistent = lines.every(
      l => (l.match(/,/g) ?? []).length === firstCommas,
    );
    if (consistent) {
      return lines.map(l => l.split(",").map(c => c.trim()));
    }
  }
  return null;
}

export function renderAsciiTable(
  rows: string[][],
  style: "sharp" | "rounded" = "sharp",
): string {
  if (rows.length === 0) return "";
  const cols = Math.max(...rows.map(r => r.length));
  const norm = rows.map(r => {
    const copy = [...r];
    while (copy.length < cols) copy.push("");
    return copy;
  });
  const widths: number[] = [];
  for (let c = 0; c < cols; c++) {
    let w = 0;
    for (const r of norm) w = Math.max(w, r[c].length);
    widths.push(w);
  }
  const pad = (s: string, w: number) => s + " ".repeat(w - s.length);

  const tl = style === "rounded" ? "╭" : "┌";
  const tr = style === "rounded" ? "╮" : "┐";
  const bl = style === "rounded" ? "╰" : "└";
  const br = style === "rounded" ? "╯" : "┘";

  const seg = (w: number) => "─".repeat(w + 2);
  const topLine = tl + widths.map(seg).join("┬") + tr;
  const midLine = "├" + widths.map(seg).join("┼") + "┤";
  const botLine = bl + widths.map(seg).join("┴") + br;

  const dataLine = (r: string[]) =>
    "│ " + r.map((c, i) => pad(c, widths[i])).join(" │ ") + " │";

  const out: string[] = [topLine];
  if (norm.length > 0) {
    out.push(dataLine(norm[0]));
    if (norm.length > 1) {
      out.push(midLine);
      for (let i = 1; i < norm.length; i++) out.push(dataLine(norm[i]));
    }
  }
  out.push(botLine);
  return out.join("\n");
}
