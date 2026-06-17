import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

test("--schema exposes both commands", async () => {
  const root = fixture({});
  const { stdout, exitCode, stderr } = await claw(root, "--schema");
  expect(exitCode, stderr).toBe(0);
  expect(stdout).toContain("index(");
  expect(stdout).toContain("read(");
});

test("index writes index.md and injects a pointer block", async () => {
  const root = fixture({ "docs/proposal.md": PROPOSAL, "AGENTS.md": "# Project\n" });
  const { stdout, exitCode, stderr } = await claw(root, "index", "--inject", "AGENTS.md");
  expect(exitCode, stderr).toBe(0);
  expect(stdout).toContain("scanned: 1");

  expect(readFileSync(join(root, "index.md"), "utf8")).toContain("[Wiki](docs/proposal.md)");
  const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
  expect(agents).toContain("# Project");
  expect(agents).toContain("<!-- claw:index -->");
  expect(agents).toContain("[Wiki](docs/proposal.md)");
});

test("index --dry-run reports without writing", async () => {
  const root = fixture({ "docs/proposal.md": PROPOSAL });
  const { stdout } = await claw(root, "index", "--dry-run");
  expect(stdout).toContain("dry_run: true");
  expect(() => readFileSync(join(root, "index.md"), "utf8")).toThrow();
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

test("read on a directory without index.md synthesizes one", async () => {
  const root = fixture({ "docs/proposal.md": PROPOSAL });
  const { stdout } = await claw(root, "read", "docs");
  expect(stdout).toContain("synthesized: true");
  expect(stdout).toContain("[Wiki](proposal.md)");
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
