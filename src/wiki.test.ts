import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  BLOCK_END,
  BLOCK_START,
  buildIndex,
  buildPointerBlock,
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

  const titles = scanDocs(root).map((d) => d.title);
  expect(titles).toEqual(["Public"]); // vendor/secret excluded via git ls-files
});

test("cedes the skill install roots (.agents/skills, .claude/skills)", () => {
  const root = fixture({
    "docs/real.md": "---\ntype: Note\ntitle: Real\n---\nx",
    ".agents/skills/foo.bar/SKILL.md": "---\nname: foo\ndescription: installed\n---\nx",
    ".claude/skills/baz/SKILL.md": "---\nname: baz\ndescription: installed\n---\nx",
    ".agents/skills/foo.bar/references/api.md": "---\ntype: Reference\ntitle: Ref\n---\nx",
  });
  const titles = scanDocs(root).map((d) => d.title);
  expect(titles).toEqual(["Real"]); // everything under the skill roots excluded
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
  expect(docs[0]).toMatchObject({
    type: "Note",
    title: "A",
    description: "first",
  });
  expect(docs[1]?.title).toBe("B"); // derived from filename
});

test("builds a YAML-stream index: file path + frontmatter verbatim per doc", () => {
  const docs: DocRecord[] = [
    {
      path: "docs/spec.md",
      type: "Spec",
      title: "Spec",
      data: { type: "Spec", title: "Spec", description: "the spec", tags: ["x"] },
    },
    { path: "readme.md", type: "Note", title: "Readme", data: { type: "Note", when: "on start" } },
  ];
  const out = buildIndex(docs);
  expect(out.startsWith("---\n")).toBe(true);
  expect(out.endsWith("---\n")).toBe(true); // terminated stream
  expect(out).toContain("file: ./docs/spec.md");
  expect(out).toContain("description: the spec");
  expect(out).toContain("when: on start");
});

test("buildIndex returns empty for no docs", () => {
  expect(buildIndex([])).toBe("");
});

test("pointer block inlines entries under the cap", () => {
  const block = buildPointerBlock([{ path: "a.md", type: "Note", title: "A", description: "d" }]);
  expect(block.startsWith(BLOCK_START)).toBe(true);
  expect(block.endsWith(BLOCK_END)).toBe(true);
  expect(block).toContain("- [A](a.md) — d");
});

test("pointer block collapses past the cap", () => {
  const many = Array.from({ length: 80 }, (_, i) => ({
    path: `d${i}.md`,
    type: "Note",
    title: `D${i}`,
  }));
  const block = buildPointerBlock(many);
  expect(block).toContain("80 docs indexed");
  expect(block).not.toContain("- [D0]");
});

test("injects then replaces a managed block idempotently", () => {
  const block = buildPointerBlock([{ path: "a.md", type: "Note", title: "A" }]);
  const once = injectManagedBlock("# Project\n", block);
  expect(once).toContain("# Project");
  expect(once).toContain(BLOCK_START);

  const newer = buildPointerBlock([{ path: "b.md", type: "Note", title: "B" }]);
  const twice = injectManagedBlock(once, newer);
  expect(twice.split(BLOCK_START).length - 1).toBe(1); // exactly one block
  expect(twice).toContain("[B](b.md)");
  expect(twice).not.toContain("[A](a.md)");
});

test("injectManagedBlock refuses to write when a marker is unbalanced", () => {
  const block = buildPointerBlock([{ path: "a.md", type: "Note", title: "A" }]);
  // start marker present, end marker missing → corrupted; must not append.
  expect(() => injectManagedBlock(`# Project\n${BLOCK_START}\nstray\n`, block)).toThrow(
    /unbalanced/,
  );
});
