import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

test("--schema exposes the four commands", async () => {
  const root = fixture({});
  const { stdout, exitCode, stderr } = await claw(root, "--schema");
  expect(exitCode, stderr).toBe(0);
  expect(stdout).toContain("index(");
  expect(stdout).toContain("read(");
  expect(stdout).toContain("install(");
  expect(stdout).toContain("uninstall(");
});

test("index prints the YAML index to stdout — no on-disk artifact", async () => {
  const root = fixture({ "docs/proposal.md": PROPOSAL });
  const { stdout, exitCode, stderr } = await claw(root, "index");
  expect(exitCode, stderr).toBe(0);
  expect(stdout).toContain("- file: ./docs/proposal.md");
  expect(stdout).toContain("type: Proposal");
  // claw never writes index.yaml; the canonical channel is stdout.
  expect(existsSync(join(root, "index.yaml"))).toBe(false);
});

test("index --inject embeds the index inline in the host file", async () => {
  const root = fixture({ "docs/proposal.md": PROPOSAL, "AGENTS.md": "# Project\n" });
  const { stdout, exitCode, stderr } = await claw(root, "index", "--inject", "AGENTS.md");
  expect(exitCode, stderr).toBe(0);
  expect(stdout).toContain("scanned: 1");
  expect(stdout).toContain("changed: true");

  const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
  expect(agents).toContain("# Project"); // existing content preserved
  expect(agents).toContain("<!-- claw:index -->");
  expect(agents).toContain("```yaml");
  expect(agents).toContain("file: ./docs/proposal.md"); // inline content, not a reference
});

test("index --inject is idempotent: re-running with no changes reports changed: false", async () => {
  const root = fixture({ "docs/proposal.md": PROPOSAL, "AGENTS.md": "# Project\n" });
  await claw(root, "index", "--inject", "AGENTS.md");
  const { stdout } = await claw(root, "index", "--inject", "AGENTS.md");
  expect(stdout).toContain("changed: false");
});

test("index --inject --quiet writes silently (for hook use)", async () => {
  const root = fixture({ "docs/proposal.md": PROPOSAL, "AGENTS.md": "# Project\n" });
  const { stdout, stderr, exitCode } = await claw(
    root,
    "index",
    "--inject",
    "AGENTS.md",
    "--quiet",
  );
  expect(exitCode, stderr).toBe(0);
  expect(stdout).toBe("");
  expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toContain("file: ./docs/proposal.md");
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

test("read on a directory prints the same index `claw index` would", async () => {
  const root = fixture({ "docs/proposal.md": PROPOSAL });
  const direct = await claw(root, "read", "docs");
  expect(direct.stdout).toContain("file: ./proposal.md");
  expect(direct.stdout).not.toContain("$claw"); // no synthesized header — this IS the index
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
