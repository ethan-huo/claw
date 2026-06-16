import watcher, { type AsyncSubscription, type Event } from "@parcel/watcher";
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
// at index time; this only needs to be roughly right. `.claw/**` is critical:
// our own snapshot/heartbeat writes must not feed back as events.
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
  snapshot: string;
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
    snapshot: join(dir, "snapshot.txt"),
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

function lockPid(lock: string): number | undefined {
  try {
    const pid = Number(readFileSync(lock, "utf8").trim());
    return Number.isInteger(pid) ? pid : undefined;
  } catch {
    return undefined;
  }
}

// The pid of a live daemon owning this repo, or undefined.
export function daemonPid(root: string): number | undefined {
  const pid = lockPid(clawPaths(root).lock);
  return pid && isAlive(pid) ? pid : undefined;
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

// Atomic O_EXCL lock holding the daemon's own pid. Reclaims a stale lock whose
// pid is dead. Returns false when a live daemon already owns the repo.
function acquireLock(lock: string): boolean {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lock, "wx"); // O_CREAT | O_EXCL | O_WRONLY
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const pid = lockPid(lock);
      if (pid && isAlive(pid)) return false;
      rmSync(lock, { force: true }); // stale — reclaim and retry
    }
  }
  return false;
}

function relevant(path: string, root: string, appendTarget: string | undefined): boolean {
  if (!path.endsWith(".md")) return false;
  if (basename(path) === "index.md") return false; // our own output
  if (appendTarget && path === appendTarget) return false; // our own output
  return true;
}

// Run the watch loop in-process. Returns undefined if another daemon already
// owns the repo. The handle's stop() unsubscribes, snapshots, and releases the
// lock. Used both by `claw daemon run` and directly by tests.
export async function startDaemon(root: string): Promise<DaemonHandle | undefined> {
  const paths = clawPaths(root);
  mkdirSync(paths.dir, { recursive: true });
  if (!acquireLock(paths.lock)) return undefined;

  const ownsLock = (): boolean => lockPid(paths.lock) === process.pid;
  const appendTarget = existsSync(join(root, "AGENTS.md")) ? join(root, "AGENTS.md") : undefined;
  const build = (): void => void reindex(root, { append: appendTarget });
  const snapshot = (): Promise<string> =>
    watcher.writeSnapshot(root, paths.snapshot, { ignore: IGNORE });

  let subscription: AsyncSubscription | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let reaper: ReturnType<typeof setInterval> | undefined;
  let stopping = false;
  let resolveStopped!: () => void;
  const stopped = new Promise<void>((resolve) => {
    resolveStopped = resolve;
  });

  // releaseLock=false is used when another daemon has taken over the lock: we
  // exit without touching what is now its lock file.
  const shutdown = async (releaseLock: boolean): Promise<void> => {
    if (stopping) return;
    stopping = true;
    if (reaper) clearInterval(reaper);
    clearTimeout(debounce);
    if (subscription) await subscription.unsubscribe().catch(() => {});
    if (releaseLock && ownsLock()) {
      try {
        await snapshot();
      } catch {
        // best-effort
      }
      rmSync(paths.lock, { force: true });
    }
    resolveStopped();
  };

  try {
    // Catch up on changes missed while no daemon was running, then re-snapshot.
    if (existsSync(paths.snapshot)) {
      let missed: Event[] = [];
      try {
        missed = await watcher.getEventsSince(root, paths.snapshot, { ignore: IGNORE });
      } catch {
        missed = [{ path: join(root, "force.md"), type: "update" }]; // unreadable → rebuild
      }
      if (missed.some((event) => relevant(event.path, root, appendTarget))) build();
    } else {
      build(); // first run for this repo
    }
    await snapshot();

    subscription = await watcher.subscribe(
      root,
      (error, events) => {
        if (error) return;
        if (!events.some((event) => relevant(event.path, root, appendTarget))) return;
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          try {
            build();
            void snapshot();
          } catch {
            // a transient bad doc must not kill the daemon
          }
        }, DEBOUNCE_MS);
      },
      { ignore: IGNORE },
    );
  } catch (error) {
    // Release our lock if startup failed after we acquired it.
    if (subscription) await subscription.unsubscribe().catch(() => {});
    if (ownsLock()) rmSync(paths.lock, { force: true });
    throw error;
  }

  reaper = setInterval(() => {
    if (!ownsLock()) {
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
