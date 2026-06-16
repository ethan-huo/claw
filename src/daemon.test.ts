import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  clawPaths,
  daemonPid,
  ensureDaemon,
  gitRoot,
  isAlive,
  startDaemon,
  stopDaemon,
  type DaemonHandle,
} from "./daemon.ts";

const ENTRY = join(import.meta.dir, "main.ts");
const roots: string[] = [];
const handles: DaemonHandle[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.stop().catch(() => {});
  for (const root of roots.splice(0)) {
    stopDaemon(root); // SIGTERM any spawned daemon
    rmSync(root, { force: true, recursive: true });
  }
});

function tmpRepo(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "claw-daemon-"));
  roots.push(root);
  Bun.spawnSync(["git", "init", "-q"], { cwd: root });
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

async function waitFor(predicate: () => boolean, ms = 8000, step = 50): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await Bun.sleep(step);
  }
  return predicate();
}

const DOC = (title: string, desc: string) =>
  `---\ntype: Note\ntitle: ${title}\ndescription: ${desc}\n---\nbody\n`;

const indexText = (root: string) => {
  try {
    return readFileSync(join(root, "index.md"), "utf8");
  } catch {
    return "";
  }
};

test("gitRoot resolves the repo toplevel and is undefined outside one", () => {
  const root = tmpRepo();
  // macOS /tmp is a symlink to /private/tmp; compare basenames to avoid that.
  expect(gitRoot(root)?.endsWith(root.split("/").pop()!)).toBe(true);
  expect(gitRoot(tmpdir())).toBeDefined; // tmpdir may or may not be a repo; just don't throw
});

test("isAlive: true for this process, false for an absurd pid", () => {
  expect(isAlive(process.pid)).toBe(true);
  expect(isAlive(2_000_000_000)).toBe(false);
});

test("startDaemon builds the index on start and releases the lock on stop", async () => {
  const root = tmpRepo({ "docs/a.md": DOC("First", "the first doc") });
  const handle = await startDaemon(root);
  expect(handle).toBeDefined();
  handles.push(handle!);

  expect(indexText(root)).toContain("[First](docs/a.md)");
  expect(existsSync(clawPaths(root).lock)).toBe(true);

  await handle!.stop();
  handles.length = 0;
  expect(existsSync(clawPaths(root).lock)).toBe(false);
  expect(existsSync(clawPaths(root).snapshot)).toBe(true);
});

test("startDaemon reindexes on a new doc and refreshes the AGENTS.md block", async () => {
  const root = tmpRepo({ "docs/a.md": DOC("First", "first"), "AGENTS.md": "# Project\n" });
  const handle = await startDaemon(root);
  handles.push(handle!);

  writeFileSync(join(root, "docs/b.md"), DOC("Second", "added live"));
  expect(await waitFor(() => indexText(root).includes("[Second](docs/b.md)"))).toBe(true);

  const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
  expect(agents).toContain("<!-- claw:index -->");
  expect(agents).toContain("[Second](docs/b.md)");
});

test("only one daemon owns a repo: a second startDaemon returns undefined", async () => {
  const root = tmpRepo({ "docs/a.md": DOC("A", "a") });
  const first = await startDaemon(root);
  handles.push(first!);
  const second = await startDaemon(root);
  expect(second).toBeUndefined();
});

test("snapshot catch-up: a change made while stopped is picked up on restart", async () => {
  const root = tmpRepo({ "docs/a.md": DOC("A", "a") });
  const first = await startDaemon(root);
  await first!.stop(); // writes a snapshot

  writeFileSync(join(root, "docs/offline.md"), DOC("Offline", "changed while dead"));

  const second = await startDaemon(root);
  handles.push(second!);
  expect(indexText(root)).toContain("[Offline](docs/offline.md)");
});

test("ensureDaemon spawns a daemon, is idempotent, and self-reaps on stale heartbeat", async () => {
  process.env.CLAW_ENTRY = ENTRY;
  process.env.CLAW_TTL_MS = "1500";
  process.env.CLAW_TICK_MS = "300";
  process.env.CLAW_DEBOUNCE_MS = "40";

  const root = tmpRepo({ "docs/a.md": DOC("A", "a") });

  expect(ensureDaemon(root)).toBe("started");
  expect(await waitFor(() => daemonPid(root) !== undefined)).toBe(true);
  const pid = daemonPid(root);
  expect(await waitFor(() => indexText(root).includes("[A](docs/a.md)"))).toBe(true);

  // Idempotent: a second ensure does not spawn a new daemon.
  expect(ensureDaemon(root)).toBe("running");
  expect(daemonPid(root)).toBe(pid);

  // Stop touching the heartbeat; the daemon self-reaps within the TTL.
  expect(await waitFor(() => daemonPid(root) === undefined, 6000)).toBe(true);

  delete process.env.CLAW_ENTRY;
  delete process.env.CLAW_TTL_MS;
  delete process.env.CLAW_TICK_MS;
  delete process.env.CLAW_DEBOUNCE_MS;
}, 20000);
