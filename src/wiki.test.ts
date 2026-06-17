import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parse } from "yaml";

import {
  BLOCK_END,
  BLOCK_START,
  buildIndex,
  inlineBlock,
  injectManagedBlock,
  referenceBlock,
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

test("builds a YAML list: file + frontmatter verbatim per doc", () => {
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

test("referenceBlock points at index.yaml, static and marker-wrapped", () => {
  const block = referenceBlock();
  expect(block.startsWith(BLOCK_START)).toBe(true);
  expect(block.endsWith(BLOCK_END)).toBe(true);
  expect(block).toContain("./index.yaml");
  expect(referenceBlock()).toBe(block); // independent of docs — no churn
});

test("inlineBlock embeds the index.yaml content in a fenced yaml block", () => {
  const block = inlineBlock([
    { path: "a.md", type: "Note", title: "A", data: { type: "Note", description: "d" } },
  ]);
  expect(block).toContain("```yaml");
  expect(block).toContain("- file: ./a.md");
  expect(block).toContain("description: d");
});

test("injects then replaces a managed block idempotently", () => {
  const once = injectManagedBlock("# Project\n", referenceBlock());
  expect(once).toContain("# Project");
  expect(once).toContain(BLOCK_START);

  const newer = inlineBlock([{ path: "b.md", type: "Note", title: "B", data: { type: "Note" } }]);
  const twice = injectManagedBlock(once, newer);
  expect(twice.split(BLOCK_START).length - 1).toBe(1); // exactly one block
  expect(twice).toContain("file: ./b.md");
  expect(twice).not.toContain("./index.yaml"); // old reference block replaced
});

test("injectManagedBlock refuses to write when a marker is unbalanced", () => {
  // start marker present, end marker missing → corrupted; must not append.
  expect(() => injectManagedBlock(`# Project\n${BLOCK_START}\nstray\n`, referenceBlock())).toThrow(
    /unbalanced/,
  );
});
