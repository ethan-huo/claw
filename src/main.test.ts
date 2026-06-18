import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const ENTRY = join(import.meta.dir, "main.ts");
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true });
});

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "claw-e2e-"));
  dirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

async function claw(cwd: string, ...args: string[]) {
  const proc = Bun.spawn(["bun", ENTRY, ...args], { cwd, stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

const PROPOSAL = [
  "---",
  "type: Proposal",
  "title: Wiki",
  "description: Unify memory and skills.",
  "---",
  "# Motivation",
  "why",
  "# Design",
  "how",
].join("\n");

test("--schema exposes the single read command", async () => {
  const root = fixture({});
  const { stdout, exitCode, stderr } = await claw(root, "--schema");
  expect(exitCode, stderr).toBe(0);
  expect(stdout).toContain("read(");
  // The inject/install surface is gone — claw is a pure reader now.
  expect(stdout).not.toContain("index(");
  expect(stdout).not.toContain("install(");
});

test("read surfaces the $claw channel and full body for short docs", async () => {
  const root = fixture({ "p.md": PROPOSAL });
  const { stdout, exitCode } = await claw(root, "read", "p.md");
  expect(exitCode).toBe(0);
  expect(stdout).toContain("$claw:");
  expect(stdout).toContain("type: Proposal");
  expect(stdout).toContain("# Motivation");
});

test("read --toc and --section navigate by heading", async () => {
  const root = fixture({ "p.md": PROPOSAL });
  const toc = await claw(root, "read", "p.md", "--toc");
  expect(toc.stdout).toContain("1 Motivation");
  expect(toc.stdout).not.toContain("$claw");

  const section = await claw(root, "read", "p.md", "--section", "2");
  expect(section.stdout.trim()).toBe("# Design\nhow");
});

test("read on a directory emits its index, computed live with no on-disk artifact", async () => {
  const root = fixture({ "docs/proposal.md": PROPOSAL });
  const direct = await claw(root, "read", "docs");
  expect(direct.stdout).toContain("file: ./proposal.md");
  expect(direct.stdout).toContain("type: Proposal");
  // Each entry carries a $claw block of tool-synthesized metadata (today: the
  // size hint), kept apart from the author's frontmatter that follows.
  expect(direct.stdout).toContain("$claw:");
  expect(direct.stdout).toMatch(/size: ~\d+ tokens, \d+ lines/);
  // claw never writes an index file; the index is always computed on read.
  expect(existsSync(join(root, "index.yaml"))).toBe(false);
});

test("read with no path indexes the current directory", async () => {
  const root = fixture({ "proposal.md": PROPOSAL });
  const { stdout, exitCode, stderr } = await claw(root, "read");
  expect(exitCode, stderr).toBe(0);
  expect(stdout).toContain("file: ./proposal.md");
});

test("read on a missing path exits 3 with a structured error", async () => {
  const root = fixture({});
  const { stdout, exitCode } = await claw(root, "read", "nope.md");
  expect(exitCode).toBe(3);
  expect(stdout).toBe(""); // errors go to stderr
});

test("read --section with no match exits 3", async () => {
  const root = fixture({ "p.md": PROPOSAL });
  const { exitCode, stderr } = await claw(root, "read", "p.md", "--section", "9");
  expect(exitCode).toBe(3);
  expect(stderr).toContain("No sections matched");
});
