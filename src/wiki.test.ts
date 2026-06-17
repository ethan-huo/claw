import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parse } from "yaml";

import {
  BLOCK_END,
  BLOCK_START,
  buildIndex,
  indexBlock,
  injectManagedBlock,
  scanDocs,
  type DocRecord,
} from "./wiki.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true });
});

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "claw-wiki-"));
  dirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

test("in a git repo, honors .gitignore exactly (no leaked ignored docs)", () => {
  const root = fixture({
    ".gitignore": "vendor/\nsecret/\n",
    "docs/pub.md": "---\ntype: Note\ntitle: Public\n---\nx",
    "vendor/v.md": "---\ntype: Note\ntitle: Vendor\n---\nx",
    "secret/s.md": "---\ntype: Note\ntitle: Secret\n---\nx",
  });
  Bun.spawnSync(["git", "init", "-q"], { cwd: root });

  expect(scanDocs(root).map((d) => d.path)).toEqual(["docs/pub.md"]);
});

test("cedes any dot-prefixed directory — Unix-hidden is infrastructure, not knowledge", () => {
  const root = fixture({
    "docs/real.md": "---\ntype: Note\ntitle: Real\n---\nx",
    ".agents/skills/foo.bar/SKILL.md": "---\nname: foo\ndescription: installed\n---\nx",
    ".claude/skills/baz/SKILL.md": "---\nname: baz\ndescription: installed\n---\nx",
    ".scratch/draft.md": "---\ntype: Note\ntitle: Draft\n---\nx",
    ".internal/notes/x.md": "---\ntype: Note\ntitle: Internal\n---\nx",
  });
  expect(scanDocs(root).map((d) => d.path)).toEqual(["docs/real.md"]);
});

test("scans frontmatter docs, skipping reserved, plain, and ignored files", () => {
  const root = fixture({
    "a.md": "---\ntype: Note\ntitle: A\ndescription: first\n---\nbody",
    "docs/b.md": "---\ntype: Spec\n---\nbody",
    "index.md": "---\ntype: Note\n---\nreserved, must be skipped",
    "plain.md": "# no frontmatter, skipped",
    "node_modules/dep/c.md": "---\ntype: Note\n---\nignored dir",
  });

  const docs = scanDocs(root);
  expect(docs.map((d) => d.path)).toEqual(["a.md", "docs/b.md"]);
  // Frontmatter is dumped verbatim — no normalization, no derivation.
  expect(docs[0]?.data).toEqual({ type: "Note", title: "A", description: "first" });
  expect(docs[1]?.data).toEqual({ type: "Spec" });
});

test("scanDocs measures body size with chars/4 token estimate and line count", () => {
  // Body is exactly 8 chars on one line: "abcdefgh" → ceil(8/4) = 2 tokens.
  const root = fixture({ "a.md": "---\ntype: Note\n---\nabcdefgh" });
  const [doc] = scanDocs(root);
  expect(doc?.size).toBe("2 tokens, 1 lines");
});

test("scanDocs counts lines without inflating on a trailing newline", () => {
  // 4 visible lines, trailing newline; --section semantics agree the doc has 4 lines.
  const body = "line 1\nline 2\nline 3\nline 4\n";
  const root = fixture({ "a.md": `---\ntype: Note\n---\n${body}` });
  const [doc] = scanDocs(root);
  expect(doc?.size).toBe(`${Math.ceil(body.length / 4)} tokens, 4 lines`);
});

test("size hint scales with body, not frontmatter — frontmatter is metadata, not payload", () => {
  // Same body, very different frontmatter weight: size must be identical.
  const body = "the body content here";
  const lean = fixture({ "a.md": `---\ntype: Note\n---\n${body}` });
  const heavy = fixture({
    "a.md": `---\ntype: Note\ntitle: A long title\ndescription: ${"x".repeat(500)}\n---\n${body}`,
  });
  expect(scanDocs(lean)[0]?.size).toBe(scanDocs(heavy)[0]?.size);
});

test("builds a YAML list: file + size + frontmatter verbatim per doc", () => {
  const docs: DocRecord[] = [
    {
      path: "docs/spec.md",
      size: "100 tokens, 10 lines",
      data: { type: "Spec", title: "Spec", description: "the spec", tags: ["x"] },
    },
    { path: "readme.md", size: "5 tokens, 1 lines", data: { type: "Note", when: "on start" } },
  ];
  const out = buildIndex(docs);
  expect(out).toContain("- file: ./docs/spec.md"); // a YAML sequence item
  expect(out).toContain("size: 100 tokens, 10 lines");
  expect(out).toContain("description: the spec");
  expect(out).toContain("when: on start");
  // round-trips to structured data — size sits next to file, before frontmatter
  expect(parse(out)).toEqual([
    {
      file: "./docs/spec.md",
      size: "100 tokens, 10 lines",
      type: "Spec",
      title: "Spec",
      description: "the spec",
      tags: ["x"],
    },
    {
      file: "./readme.md",
      size: "5 tokens, 1 lines",
      type: "Note",
      when: "on start",
    },
  ]);
});

test("an author-written `size` in frontmatter wins over the synthesized hint", () => {
  // Same principle that keeps us from synthesizing other fields: if the
  // author cared enough to write it, surface their value, not ours.
  const out = buildIndex([
    { path: "a.md", size: "100 tokens, 10 lines", data: { type: "Note", size: "tiny" } },
  ]);
  expect(parse(out)).toEqual([{ file: "./a.md", size: "tiny", type: "Note" }]);
});

test("buildIndex emits an empty YAML list for no docs", () => {
  expect(parse(buildIndex([]))).toEqual([]);
});

test("indexBlock embeds the index in a fenced yaml block", () => {
  const block = indexBlock([
    { path: "a.md", size: "1 tokens, 1 lines", data: { type: "Note", description: "d" } },
  ]);
  expect(block.startsWith(BLOCK_START)).toBe(true);
  expect(block.endsWith(BLOCK_END)).toBe(true);
  expect(block).toContain("```yaml");
  expect(block).toContain("- file: ./a.md");
  expect(block).toContain("description: d");
});

test("indexBlock pads the fence with blank lines — keeps formatters from rewriting it", () => {
  // CommonMark formatters (oxfmt, prettier) insert blank lines around fenced
  // code blocks. If claw doesn't emit them, every hook → format → hook cycle
  // re-dirties the host file. Lock the layout in.
  const block = indexBlock([{ path: "a.md", size: "1 tokens, 1 lines", data: { type: "Note" } }]);
  expect(block).toContain("\n\n```yaml");
  expect(block).toContain("```\n\n<!-- /claw:index -->");
});

test("injects then replaces a managed block idempotently", () => {
  const first = indexBlock([{ path: "a.md", size: "1 tokens, 1 lines", data: { type: "Note" } }]);
  const once = injectManagedBlock("# Project\n", first);
  expect(once).toContain("# Project");
  expect(once).toContain(BLOCK_START);
  expect(once).toContain("file: ./a.md");

  const newer = indexBlock([{ path: "b.md", size: "1 tokens, 1 lines", data: { type: "Note" } }]);
  const twice = injectManagedBlock(once, newer);
  expect(twice.split(BLOCK_START).length - 1).toBe(1); // exactly one block
  expect(twice).toContain("file: ./b.md");
  expect(twice).not.toContain("file: ./a.md"); // old block replaced
});

test("injectManagedBlock refuses to write when a marker is unbalanced", () => {
  // start marker present, end marker missing → corrupted; must not append.
  const block = indexBlock([{ path: "a.md", size: "1 tokens, 1 lines", data: { type: "Note" } }]);
  expect(() => injectManagedBlock(`# Project\n${BLOCK_START}\nstray\n`, block)).toThrow(
    /unbalanced/,
  );
});
