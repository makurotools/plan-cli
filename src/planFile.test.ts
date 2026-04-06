import { test, expect, describe } from "bun:test";
import {
  findDiagramBlock,
  findDiagramBlocks,
  spliceDiagramAt,
  findTaskLines,
  toggleTaskLine,
  spliceDiagram,
  findSection,
  spliceSection,
  hasPlanStructure,
  scaffoldPlanStructure,
  extractPlanView,
  applyPatch,
} from "./planFile";

describe("findDiagramBlock", () => {
  test("no fence in file", () => {
    const loc = findDiagramBlock("# Hello\n\nPlain markdown.\n");
    expect(loc.exists).toBe(false);
    expect(loc.content).toBe("");
  });

  test("plan-tagged fence", () => {
    const raw = "intro\n\n```plan\nbox\n```\n\nfooter\n";
    const loc = findDiagramBlock(raw);
    expect(loc.exists).toBe(true);
    expect(loc.content).toBe("box");
  });

  test("diagram-tagged fence", () => {
    const raw = "```diagram\na\nb\n```";
    const loc = findDiagramBlock(raw);
    expect(loc.exists).toBe(true);
    expect(loc.content).toBe("a\nb");
  });

  test("ascii-tagged fence", () => {
    const loc = findDiagramBlock("```ascii\nX\n```");
    expect(loc.exists).toBe(true);
    expect(loc.content).toBe("X");
  });

  test("plain ``` fence is ignored", () => {
    const loc = findDiagramBlock("```\nnot a diagram\n```");
    expect(loc.exists).toBe(false);
  });

  test("unclosed fence gives up", () => {
    const loc = findDiagramBlock("```plan\nno close");
    expect(loc.exists).toBe(false);
  });

  test("empty diagram block", () => {
    const loc = findDiagramBlock("```plan\n```");
    expect(loc.exists).toBe(true);
    expect(loc.content).toBe("");
  });
});

describe("spliceDiagram", () => {
  test("lazy-create in empty file", () => {
    const out = spliceDiagram("", "box");
    expect(out).toBe("```plan\nbox\n```\n");
  });

  test("lazy-create preserves existing content", () => {
    const raw = "# Header\n\nSome text.\n";
    const out = spliceDiagram(raw, "box");
    expect(out).toBe("# Header\n\nSome text.\n\n```plan\nbox\n```\n");
  });

  test("lazy-create adds double newline when needed", () => {
    const raw = "no trailing newline";
    const out = spliceDiagram(raw, "box");
    expect(out).toBe("no trailing newline\n\n```plan\nbox\n```\n");
  });

  test("no lazy-create when newContent empty", () => {
    const raw = "# Header\n\nJust text.\n";
    expect(spliceDiagram(raw, "")).toBe(raw);
  });

  test("replace existing block, preserve surrounding bytes", () => {
    const raw = "before\n\n```plan\nold\n```\n\nafter\n";
    const out = spliceDiagram(raw, "new line 1\nnew line 2");
    expect(out).toBe("before\n\n```plan\nnew line 1\nnew line 2\n```\n\nafter\n");
  });

  test("replace with equal content is byte-identical", () => {
    const raw = "```plan\nsame\n```\n";
    expect(spliceDiagram(raw, "same")).toBe(raw);
  });

  test("preserves diagram tag variant on replace", () => {
    const raw = "```diagram\nold\n```";
    const out = spliceDiagram(raw, "new");
    expect(out).toBe("```diagram\nnew\n```");
  });

  test("clearing existing diagram keeps the block (empty)", () => {
    const raw = "```plan\nold\n```\n";
    const out = spliceDiagram(raw, "");
    expect(out).toBe("```plan\n```\n");
  });
});

describe("findSection", () => {
  test("not found returns exists:false", () => {
    const loc = findSection("# hi\n", "task");
    expect(loc.exists).toBe(false);
  });

  test("english heading", () => {
    const raw = "## Task\n\n- [ ] one\n- [x] two\n";
    const loc = findSection(raw, "task");
    expect(loc.exists).toBe(true);
    expect(loc.content).toBe("- [ ] one\n- [x] two");
  });

  test("indonesian heading", () => {
    const raw = "## Tugas\n\n- [ ] satu\n";
    const loc = findSection(raw, "task");
    expect(loc.exists).toBe(true);
    expect(loc.content).toBe("- [ ] satu");
  });

  test("stops at next ## heading", () => {
    const raw = "## Task\n- a\n\n## Notes\n- b\n";
    expect(findSection(raw, "task").content).toBe("- a");
    expect(findSection(raw, "notes").content).toBe("- b");
  });
});

describe("spliceSection", () => {
  test("noop if section missing", () => {
    const raw = "# hi\n";
    expect(spliceSection(raw, "task", "anything")).toBe(raw);
  });

  test("noop if content unchanged", () => {
    const raw = "## Task\n\n- a\n";
    expect(spliceSection(raw, "task", "- a")).toBe(raw);
  });

  test("replace body preserves surrounding sections", () => {
    const raw = "# Top\n\n## Context\n\nctx\n\n## Task\n\n- old\n\n## Notes\n\nn\n";
    const out = spliceSection(raw, "task", "- new 1\n- new 2");
    expect(out).toContain("## Context\n\nctx\n");
    expect(out).toContain("## Task\n\n- new 1\n- new 2\n");
    expect(out).toContain("## Notes\n\nn\n");
  });

  test("empty body keeps heading", () => {
    const raw = "## Task\n\n- old\n\n## Notes\n\nhi\n";
    const out = spliceSection(raw, "task", "");
    expect(out).toContain("## Task\n");
    expect(out).toContain("## Notes\n\nhi\n");
    expect(out).not.toContain("- old");
  });
});

describe("hasPlanStructure", () => {
  test("false for plain markdown", () => {
    expect(hasPlanStructure("# readme\n\ntext\n")).toBe(false);
  });
  test("true if any section heading present", () => {
    expect(hasPlanStructure("## Task\n")).toBe(true);
    expect(hasPlanStructure("## Notes\n")).toBe(true);
    expect(hasPlanStructure("## Konteks\n")).toBe(true);
  });
  test("diagram block alone does not count", () => {
    expect(hasPlanStructure("```plan\nx\n```\n")).toBe(false);
  });
});

describe("scaffoldPlanStructure", () => {
  test("appends all four sections to empty file", () => {
    const out = scaffoldPlanStructure("");
    expect(out).toContain("## Context");
    expect(out).toContain("## Scope");
    expect(out).toContain("## Task");
    expect(out).toContain("## Notes");
  });

  test("idempotent — does not duplicate existing sections", () => {
    const raw = "## Task\n\n- a\n";
    const out = scaffoldPlanStructure(raw);
    // Task already existed, should not be duplicated
    const matches = (out.match(/^## Task\b/gm) ?? []).length;
    expect(matches).toBe(1);
    expect(out).toContain("## Context");
    expect(out).toContain("## Scope");
    expect(out).toContain("## Notes");
  });

  test("preserves pre-existing diagram", () => {
    const raw = "```plan\nbox\n```\n";
    const out = scaffoldPlanStructure(raw);
    expect(out.startsWith("```plan\nbox\n```\n")).toBe(true);
  });
});

describe("extractPlanView", () => {
  test("plain file has no structure, no diagram", () => {
    const view = extractPlanView("# hi\n");
    expect(view.hasDiagram).toBe(false);
    expect(view.hasStructure).toBe(false);
    expect(view.diagram).toBe("");
    expect(view.sections.task).toBe("");
  });

  test("file with all fields populated", () => {
    const raw = "## Task\n\n- a\n\n## Notes\n\nn\n\n```plan\nbox\n```\n";
    const view = extractPlanView(raw);
    expect(view.hasDiagram).toBe(true);
    expect(view.hasStructure).toBe(true);
    expect(view.diagram).toBe("box");
    expect(view.sections.task).toBe("- a");
    expect(view.sections.notes).toBe("n");
  });
});

describe("applyPatch", () => {
  test("noop patch is byte-identical", () => {
    const raw = "# hi\n\n```plan\nx\n```\n";
    expect(applyPatch(raw, {})).toBe(raw);
    expect(applyPatch(raw, { diagram: "x" })).toBe(raw);
  });

  test("edits diagram and section together", () => {
    const raw = "## Task\n\n- a\n\n```plan\nold\n```\n";
    const out = applyPatch(raw, {
      diagram: "new",
      sections: { task: "- a\n- b" },
    });
    expect(out).toContain("```plan\nnew\n```");
    expect(out).toContain("## Task\n\n- a\n- b");
  });

  test("section patch with missing heading is noop for that section", () => {
    const raw = "# hi\n";
    const out = applyPatch(raw, { sections: { task: "- a" } });
    expect(out).toBe(raw);
  });

  test("diagram patch on file without diagram creates block", () => {
    const raw = "# hi\n";
    const out = applyPatch(raw, { diagram: "box" });
    expect(out).toBe("# hi\n\n```plan\nbox\n```\n");
  });
});

describe("findDiagramBlocks / spliceDiagramAt", () => {
  test("finds multiple blocks with diagram/ascii/plan fences", () => {
    const raw =
      "# hi\n\n```plan\nA\n```\n\nmid\n\n```diagram\nB\n```\n\nend\n\n```ascii\nC\n```\n";
    const blocks = findDiagramBlocks(raw);
    expect(blocks.length).toBe(3);
    expect(blocks[0].content).toBe("A");
    expect(blocks[1].content).toBe("B");
    expect(blocks[2].content).toBe("C");
  });

  test("ignores non-diagram fences", () => {
    const raw = "```bash\nls\n```\n\n```plan\nX\n```\n";
    const blocks = findDiagramBlocks(raw);
    expect(blocks.length).toBe(1);
    expect(blocks[0].content).toBe("X");
  });

  test("spliceDiagramAt replaces only the targeted block", () => {
    const raw = "```plan\nA\n```\n\n```plan\nB\n```\n";
    const out = spliceDiagramAt(raw, 1, "B2");
    expect(out).toBe("```plan\nA\n```\n\n```plan\nB2\n```\n");
  });

  test("spliceDiagramAt out-of-range is a noop", () => {
    const raw = "```plan\nA\n```\n";
    expect(spliceDiagramAt(raw, 5, "Z")).toBe(raw);
  });
});

describe("findTaskLines / toggleTaskLine", () => {
  test("finds top-level and indented tasks", () => {
    const raw = "- [ ] a\n- [x] b\n  - [ ] c\n";
    const tasks = findTaskLines(raw);
    expect(tasks.length).toBe(3);
    expect(tasks[0].done).toBe(false);
    expect(tasks[1].done).toBe(true);
    expect(tasks[2].indent).toBe(2);
    expect(tasks[2].bracketCol).toBe(4);
  });

  test("ignores task-looking lines inside code fences", () => {
    const raw = "- [ ] real\n\n```bash\n- [ ] fake\n```\n\n- [x] real2\n";
    const tasks = findTaskLines(raw);
    expect(tasks.length).toBe(2);
    expect(tasks[0].text).toBe("real");
    expect(tasks[1].text).toBe("real2");
  });

  test("toggleTaskLine flips the single checkbox char, nothing else", () => {
    const raw = "- [ ] hello world\n- [x] done\n";
    const out = toggleTaskLine(raw, 0);
    expect(out).toBe("- [x] hello world\n- [x] done\n");
    const out2 = toggleTaskLine(out, 1);
    expect(out2).toBe("- [x] hello world\n- [ ] done\n");
  });

  test("toggleTaskLine on non-task line is a noop", () => {
    const raw = "# heading\n- [ ] a\n";
    expect(toggleTaskLine(raw, 0)).toBe(raw);
  });
});

describe("non-destructive guarantees", () => {
  test("README.md style file is preserved through round trip", () => {
    const raw = "# My Project\n\nSome intro paragraph.\n\n## Install\n\n```bash\nnpm install\n```\n\n## Usage\n\nMore text here.\n";
    // Opening and saving with no changes should be noop
    const view = extractPlanView(raw);
    expect(view.hasDiagram).toBe(false); // ```bash is not a diagram fence
    expect(view.hasStructure).toBe(false);
    // No-op save
    expect(applyPatch(raw, {})).toBe(raw);
    // Adding a diagram should not touch existing content
    const out = applyPatch(raw, { diagram: "box" });
    expect(out.startsWith(raw)).toBe(true);
    expect(out.endsWith("```plan\nbox\n```\n")).toBe(true);
  });
});
