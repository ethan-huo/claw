import watcher, { type AsyncSubscription } from "@parcel/watcher";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { basename, join } from "node:path";

import { reindex } from "./reindex.ts";

// Tunable via env so tests can run fast. Defaults match docs/index-daemon.md.
const TTL_MS = Number(process.env.CLAW_TTL_MS ?? 30 * 60 * 1000); // idle before self-exit
const TICK_MS = Number(process.env.CLAW_TICK_MS ?? 10 * 60 * 1000); // heartbeat self-check
const DEBOUNCE_MS = Number(process.env.CLAW_DEBOUNCE_MS ?? 150);

// Coarse performance prune for the watch layer. Precise filtering is git's job
// at index time (scanDocs uses `git ls-files`); this only needs to be roughly
// right. `.claw/**` is critical: our own writes must not feed back as events.
const IGNORE = [
  "node_modules/**",
  ".git/**",
  "dist/**",
  "build/**",
  "coverage/**",
  ".next/**",
  ".claw/**",
];

export type ClawPaths = {
  dir: string;
  lock: string;
  heartbeat: string;
  log: string;
};

export type DaemonHandle = {
  root: string;
  stopped: Promise<void>; // resolves when the daemon stops (reaped, signaled, or explicit)
  stop(): Promise<void>;
};

export function clawPaths(root: string): ClawPaths {
  const dir = join(root, ".claw");
  return {
    dir,
    lock: join(dir, "daemon.lock"),
    heartbeat: join(dir, "heartbeat"),
    log: join(dir, "daemon.log"),
  };
}

export function gitRoot(cwd: string = process.cwd()): string | undefined {
  const result = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], { cwd, stderr: "ignore" });
  if (result.exitCode !== 0) return undefined;
  return result.stdout.toString().trim() || undefined;
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"; // exists, just not ours
  }
}

// Process start time, used to tell a live daemon from an unrelated process that
// happened to reuse its pid after a crash.
function procStartTime(pid: number): string | undefined {
  const result = Bun.spawnSync(["ps", "-o", "lstart=", "-p", String(pid)], { stderr: "ignore" });
  if (result.exitCode !== 0) return undefined;
  return result.stdout.toString().trim() || undefined;
}

type LockOwner = { pid: number; start: string };

function readLock(lock: string): LockOwner | undefined {
  try {
    const [pidLine, start] = readFileSync(lock, "utf8").split("\n");
    const pid = Number((pidLine ?? "").trim());
    if (Number.isInteger(pid) && start) return { pid, start: start.trim() };
  } catch {
    // missing or malformed
  }
  return undefined;
}

// The pid of a live daemon owning this repo, or undefined. Verifies the lock
// holder is the *same* process instance (pid + start time), so a reused pid
// cannot masquerade as a live daemon and wedge `ensure` forever.
export function daemonPid(root: string): number | undefined {
  const owner = readLock(clawPaths(root).lock);
  if (!owner || !isAlive(owner.pid)) return undefined;
  return procStartTime(owner.pid) === owner.start ? owner.pid : undefined;
}

export function heartbeatAge(root: string): number {
  try {
    return Date.now() - statSync(clawPaths(root).heartbeat).mtimeMs;
  } catch {
    return Infinity;
  }
}

export function touchHeartbeat(root: string): void {
  const paths = clawPaths(root);
  mkdirSync(paths.dir, { recursive: true });
  writeFileSync(paths.heartbeat, String(Date.now()));
}

// Atomic O_EXCL lock holding pid + start time. Reclaims a lock whose owner is
// no longer a live instance. Returns false when a live daemon already owns it.
function acquireLock(lock: string): boolean {
  const identity = `${process.pid}\n${procStartTime(process.pid) ?? ""}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lock, "wx"); // O_CREAT | O_EXCL | O_WRONLY
      writeSync(fd, identity);
      closeSync(fd);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const owner = readLock(lock);
      if (owner && isAlive(owner.pid) && procStartTime(owner.pid) === owner.start) return false;
      rmSync(lock, { force: true }); // stale — reclaim and retry
    }
  }
  return false;
}

// React only to markdown that isn't our own output. parcel gives absolute paths.
function relevant(path: string, root: string): boolean {
  if (!path.endsWith(".md")) return false;
  if (basename(path) === "index.md") return false; // generated index
  if (path === join(root, "AGENTS.md")) return false; // pointer-block host
  return true;
}

// Run the watch loop in-process. Returns undefined if another daemon already
// owns the repo. The handle's stop() unsubscribes and releases the lock; its
// `stopped` promise resolves on stop for ANY reason. Used by `claw daemon run`
// and directly by tests.
export async function startDaemon(root: string): Promise<DaemonHandle | undefined> {
  const paths = clawPaths(root);
  mkdirSync(paths.dir, { recursive: true });
  if (!acquireLock(paths.lock)) return undefined;

  const ownsLock = (): boolean => readLock(paths.lock)?.pid === process.pid;
  const agentsPath = join(root, "AGENTS.md");
  // Resolve the inject target per build: an AGENTS.md created after startup
  // still gets its pointer block on the next change.
  const build = (): void => {
    try {
      reindex(root, { inject: existsSync(agentsPath) ? agentsPath : undefined });
    } catch (error) {
      process.stderr.write(`[claw] reindex failed: ${String(error)}\n`);
    }
  };

  let subscription: AsyncSubscription | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let reaper: ReturnType<typeof setInterval> | undefined;
  let stopping = false;
  let resolveStopped!: () => void;
  const stopped = new Promise<void>((resolve) => {
    resolveStopped = resolve;
  });

  const shutdown = async (releaseLock: boolean): Promise<void> => {
    if (stopping) return;
    stopping = true;
    if (reaper) clearInterval(reaper);
    clearTimeout(debounce);
    if (subscription) await subscription.unsubscribe().catch(() => {});
    if (releaseLock && ownsLock()) rmSync(paths.lock, { force: true });
    resolveStopped();
  };

  build(); // a full scan on startup also catches anything changed while we were down

  try {
    subscription = await watcher.subscribe(
      root,
      (error, events) => {
        if (error || !existsSync(paths.dir)) {
          void shutdown(false); // watcher failed or the repo vanished — stop now
          return;
        }
        if (!events.some((event) => relevant(event.path, root))) return;
        clearTimeout(debounce);
        debounce = setTimeout(build, DEBOUNCE_MS);
      },
      { ignore: IGNORE },
    );
  } catch (error) {
    if (ownsLock()) rmSync(paths.lock, { force: true });
    throw error;
  }

  reaper = setInterval(() => {
    if (!existsSync(paths.dir)) {
      void shutdown(false); // repo/state gone — exit, nothing to clean
    } else if (!ownsLock()) {
      void shutdown(false); // another daemon won the lock — yield to it
    } else if (heartbeatAge(root) > TTL_MS) {
      void shutdown(true); // idle past the TTL — reap
    }
  }, TICK_MS);

  return { root, stopped, stop: () => shutdown(true) };
}

export type EnsureResult = "started" | "running" | "not-a-repo";

// Hook entry point: refresh the heartbeat and ensure a daemon is up. Idempotent
// — a live daemon short-circuits to just the heartbeat touch.
export function ensureDaemon(root: string): EnsureResult {
  touchHeartbeat(root);
  if (daemonPid(root)) return "running";

  const paths = clawPaths(root);
  const entry = process.env.CLAW_ENTRY ?? process.argv[1];
  if (!entry) return "not-a-repo";

  const logFd = openSync(paths.log, "a");
  try {
    const child = Bun.spawn([process.execPath, entry, "daemon", "run", "--root", root], {
      cwd: root,
      stdin: "ignore",
      stdout: logFd,
      stderr: logFd,
      env: { ...process.env }, // detached daemon captures the current environment
    });
    child.unref(); // outlive this hook invocation
  } finally {
    closeSync(logFd); // the child holds its own dup; don't leak ours
  }
  return "started";
}

export function stopDaemon(root: string): number | undefined {
  const pid = daemonPid(root);
  if (pid) process.kill(pid, "SIGTERM");
  return pid;
}
