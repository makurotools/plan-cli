/**
 * Splice-based plan file operations.
 *
 * Guarantee: never mutates bytes outside the diagram block or the specific
 * section being edited. Opening a file, typing nothing, and saving must
 * produce a byte-identical file. Typing a diagram into a file without a
 * diagram block appends ` ```plan ` at the end (lazy-create); never
 * rewrites or reformats pre-existing content.
 */

const DIAGRAM_FENCE_RE = /^```(plan|diagram|ascii)\s*$/i;
const CLOSE_FENCE_RE = /^```\s*$/;
const ANY_H2_RE = /^##\s+/;

const SECTION_RE: Record<SectionKey, RegExp> = {
  context: /^##\s+(context|konteks)\s*$/i,
  scope: /^##\s+(scope|cakupan)\s*$/i,
  task: /^##\s+(tasks?|tugas)\s*$/i,
  notes: /^##\s+(notes?|catatan)\s*$/i,
};

const SECTION_LABEL: Record<SectionKey, string> = {
  context: "Context",
  scope: "Scope",
  task: "Task",
  notes: "Notes",
};

export type SectionKey = "context" | "scope" | "task" | "notes";

export const SECTION_KEYS: SectionKey[] = ["context", "scope", "task", "notes"];

export type DiagramLocation = {
  exists: boolean;
  content: string;
  openLineIdx: number;
  closeLineIdx: number;
};

export type SectionLocation = {
  exists: boolean;
  content: string;
  headingLineIdx: number;
  endLineIdx: number;
};

// ---------------------------------------------------------------------------
// Diagram
// ---------------------------------------------------------------------------

export function findDiagramBlock(raw: string): DiagramLocation {
  const all = findDiagramBlocks(raw);
  if (all.length > 0) return all[0];
  return { exists: false, content: "", openLineIdx: -1, closeLineIdx: -1 };
}

/**
 * Find every diagram fenced code block in the file, in order.
 * An "unclosed" fence is skipped (we only return well-formed blocks).
 */
export function findDiagramBlocks(raw: string): DiagramLocation[] {
  const lines = raw.split("\n");
  const out: DiagramLocation[] = [];
  let i = 0;
  while (i < lines.length) {
    if (DIAGRAM_FENCE_RE.test(lines[i])) {
      let j = i + 1;
      while (j < lines.length && !CLOSE_FENCE_RE.test(lines[j])) j++;
      if (j < lines.length) {
        out.push({
          exists: true,
          content: lines.slice(i + 1, j).join("\n"),
          openLineIdx: i,
          closeLineIdx: j,
        });
        i = j + 1;
        continue;
      }
      break; // unclosed → stop scanning
    }
    i++;
  }
  return out;
}

/**
 * Replace the N-th diagram block's content (0-indexed). No-op if index
 * out of range or content unchanged. Does not touch anything outside the
 * target block.
 */
export function spliceDiagramAt(
  raw: string,
  index: number,
  newContent: string,
): string {
  const blocks = findDiagramBlocks(raw);
  const loc = blocks[index];
  if (!loc) return raw;
  if (loc.content === newContent) return raw;
  const lines = raw.split("\n");
  const body = newContent === "" ? [] : newContent.split("\n");
  const next = [
    ...lines.slice(0, loc.openLineIdx + 1),
    ...body,
    ...lines.slice(loc.closeLineIdx),
  ];
  return next.join("\n");
}

export function spliceDiagram(raw: string, newContent: string): string {
  const loc = findDiagramBlock(raw);
  if (loc.exists) {
    if (loc.content === newContent) return raw;
    const lines = raw.split("\n");
    const body = newContent === "" ? [] : newContent.split("\n");
    const next = [
      ...lines.slice(0, loc.openLineIdx + 1),
      ...body,
      ...lines.slice(loc.closeLineIdx),
    ];
    return next.join("\n");
  }
  // Lazy-create: only if user actually has content to save
  if (newContent === "") return raw;
  const sep =
    raw.length === 0
      ? ""
      : raw.endsWith("\n\n")
        ? ""
        : raw.endsWith("\n")
          ? "\n"
          : "\n\n";
  return raw + sep + "```plan\n" + newContent + "\n```\n";
}

// ---------------------------------------------------------------------------
// Task lines (interactive checkboxes, anywhere in the file)
// ---------------------------------------------------------------------------

const TASK_RE = /^(\s*)- \[([ xX])\](.*)$/;

export type TaskLine = {
  lineIdx: number;
  indent: number;
  bracketCol: number; // column of the `[` char
  done: boolean;
  text: string;
};

/**
 * Build a per-line mask: true if the line sits inside any fenced code
 * block (the fence lines themselves also get `true`). Used to skip
 * literal `- [ ]` strings that happen to live inside bash/js/etc blocks.
 */
function buildFenceMask(lines: string[]): boolean[] {
  const mask = new Array<boolean>(lines.length).fill(false);
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i])) {
      mask[i] = true;
      inFence = !inFence;
      continue;
    }
    mask[i] = inFence;
  }
  return mask;
}

export function findTaskLines(raw: string): TaskLine[] {
  const lines = raw.split("\n");
  const mask = buildFenceMask(lines);
  const out: TaskLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (mask[i]) continue;
    const m = lines[i].match(TASK_RE);
    if (!m) continue;
    const indent = m[1].length;
    out.push({
      lineIdx: i,
      indent,
      bracketCol: indent + 2, // "- " is 2 chars, bracket follows
      done: m[2].toLowerCase() === "x",
      text: m[3].trim(),
    });
  }
  return out;
}

export function toggleTaskLine(raw: string, lineIdx: number): string {
  const lines = raw.split("\n");
  const line = lines[lineIdx];
  if (line === undefined) return raw;
  const m = line.match(TASK_RE);
  if (!m) return raw;
  const indent = m[1].length;
  const checkCol = indent + 3; // between the brackets: "- [" = 3 chars
  const cur = line[checkCol];
  const next = cur === " " ? "x" : " ";
  lines[lineIdx] = line.slice(0, checkCol) + next + line.slice(checkCol + 1);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function findSection(raw: string, key: SectionKey): SectionLocation {
  const lines = raw.split("\n");
  const re = SECTION_RE[key];
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) {
      let j = i + 1;
      // Section body extends until the next ## heading OR a diagram fence,
      // whichever comes first. This keeps the diagram block conceptually
      // independent of any section it happens to sit after.
      while (
        j < lines.length &&
        !ANY_H2_RE.test(lines[j]) &&
        !DIAGRAM_FENCE_RE.test(lines[j])
      ) {
        j++;
      }
      // Content = body lines between heading and next heading (or EOF),
      // trimmed of leading/trailing blank lines.
      let s = i + 1;
      let e = j;
      while (s < e && lines[s].trim() === "") s++;
      while (e > s && lines[e - 1].trim() === "") e--;
      return {
        exists: true,
        content: lines.slice(s, e).join("\n"),
        headingLineIdx: i,
        endLineIdx: j,
      };
    }
  }
  return { exists: false, content: "", headingLineIdx: -1, endLineIdx: -1 };
}

export function spliceSection(
  raw: string,
  key: SectionKey,
  newContent: string,
): string {
  const loc = findSection(raw, key);
  if (!loc.exists) return raw;
  if (loc.content === newContent) return raw;
  const lines = raw.split("\n");
  const heading = lines[loc.headingLineIdx];
  const body = newContent === "" ? [] : newContent.split("\n");
  const atEof = loc.endLineIdx >= lines.length;
  const replacement: string[] = [heading, ""];
  if (body.length > 0) replacement.push(...body, "");
  if (atEof && replacement[replacement.length - 1] !== "") replacement.push("");
  const next = [
    ...lines.slice(0, loc.headingLineIdx),
    ...replacement,
    ...lines.slice(loc.endLineIdx),
  ];
  return next.join("\n");
}

// ---------------------------------------------------------------------------
// Plan structure detection + scaffolding
// ---------------------------------------------------------------------------

export function hasPlanStructure(raw: string): boolean {
  for (const key of SECTION_KEYS) {
    if (findSection(raw, key).exists) return true;
  }
  return false;
}

export function scaffoldPlanStructure(raw: string): string {
  const missing: string[] = [];
  for (const key of SECTION_KEYS) {
    if (!findSection(raw, key).exists) {
      missing.push(`## ${SECTION_LABEL[key]}\n`);
    }
  }
  if (missing.length === 0) return raw;
  const sep =
    raw.length === 0
      ? ""
      : raw.endsWith("\n\n")
        ? ""
        : raw.endsWith("\n")
          ? "\n"
          : "\n\n";
  return raw + sep + missing.join("\n");
}

// ---------------------------------------------------------------------------
// Extract view (for API responses / CLI rendering)
// ---------------------------------------------------------------------------

export type PlanView = {
  diagram: string;
  hasDiagram: boolean;
  hasStructure: boolean;
  sections: Record<SectionKey, string>;
};

export function extractPlanView(raw: string): PlanView {
  const diagram = findDiagramBlock(raw);
  const sections: Record<SectionKey, string> = {
    context: "",
    scope: "",
    task: "",
    notes: "",
  };
  for (const key of SECTION_KEYS) {
    sections[key] = findSection(raw, key).content;
  }
  return {
    diagram: diagram.content,
    hasDiagram: diagram.exists,
    hasStructure: SECTION_KEYS.some(k => sections[k] !== "" || findSection(raw, k).exists),
    sections,
  };
}

// ---------------------------------------------------------------------------
// Patch (combined mutation)
// ---------------------------------------------------------------------------

export type PlanPatch = {
  diagram?: string;
  sections?: Partial<Record<SectionKey, string>>;
};

export function applyPatch(raw: string, patch: PlanPatch): string {
  let result = raw;
  if (typeof patch.diagram === "string") {
    result = spliceDiagram(result, patch.diagram);
  }
  if (patch.sections) {
    for (const key of SECTION_KEYS) {
      const v = patch.sections[key];
      if (typeof v === "string") {
        result = spliceSection(result, key, v);
      }
    }
  }
  return result;
}
