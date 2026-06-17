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

test("builds a YAML list: file + frontmatter verbatim per doc", () => {
  const docs: DocRecord[] = [
    {
      path: "docs/spec.md",
      data: { type: "Spec", title: "Spec", description: "the spec", tags: ["x"] },
    },
    { path: "readme.md", data: { type: "Note", when: "on start" } },
  ];
  const out = buildIndex(docs);
  expect(out).toContain("- file: ./docs/spec.md"); // a YAML sequence item
  expect(out).toContain("description: the spec");
  expect(out).toContain("when: on start");
  // round-trips to structured data
  expect(parse(out)).toEqual([
    { file: "./docs/spec.md", type: "Spec", title: "Spec", description: "the spec", tags: ["x"] },
    { file: "./readme.md", type: "Note", when: "on start" },
  ]);
});

test("buildIndex emits an empty YAML list for no docs", () => {
  expect(parse(buildIndex([]))).toEqual([]);
});

test("indexBlock embeds the index in a fenced yaml block", () => {
  const block = indexBlock([{ path: "a.md", data: { type: "Note", description: "d" } }]);
  expect(block.startsWith(BLOCK_START)).toBe(true);
  expect(block.endsWith(BLOCK_END)).toBe(true);
  expect(block).toContain("```yaml");
  expect(block).toContain("- file: ./a.md");
  expect(block).toContain("description: d");
});

test("injects then replaces a managed block idempotently", () => {
  const first = indexBlock([{ path: "a.md", data: { type: "Note" } }]);
  const once = injectManagedBlock("# Project\n", first);
  expect(once).toContain("# Project");
  expect(once).toContain(BLOCK_START);
  expect(once).toContain("file: ./a.md");

  const newer = indexBlock([{ path: "b.md", data: { type: "Note" } }]);
  const twice = injectManagedBlock(once, newer);
  expect(twice.split(BLOCK_START).length - 1).toBe(1); // exactly one block
  expect(twice).toContain("file: ./b.md");
  expect(twice).not.toContain("file: ./a.md"); // old block replaced
});

test("injectManagedBlock refuses to write when a marker is unbalanced", () => {
  // start marker present, end marker missing → corrupted; must not append.
  const block = indexBlock([{ path: "a.md", data: { type: "Note" } }]);
  expect(() => injectManagedBlock(`# Project\n${BLOCK_START}\nstray\n`, block)).toThrow(
    /unbalanced/,
  );
});
