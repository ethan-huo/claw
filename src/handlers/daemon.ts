import { resolve } from "node:path";

import type { AppHandlers } from "../schema.ts";

import { handled } from "../handler.ts";
import { printResult } from "../output.ts";
import {
  daemonPid,
  ensureDaemon,
  gitRoot,
  heartbeatAge,
  startDaemon,
  stopDaemon,
} from "../daemon.ts";
import { installHooks, uninstallHooks } from "../hooks.ts";
import { scanDocs } from "../wiki.ts";

export const daemonHandlers: Pick<AppHandlers, "daemon"> = {
  daemon: {
    install: handled(async (options) => {
      const root = gitRoot() ?? process.cwd();
      const result = installHooks(root);
      printResult(
        {
          ok: true,
          settings: result.settingsPath,
          created: result.created,
          added: result.added,
          already_present: result.alreadyPresent,
        },
        options.context.format,
      );
    }),

    uninstall: handled(async (options) => {
      const root = gitRoot() ?? process.cwd();
      const result = uninstallHooks(root);
      printResult(
        { ok: true, settings: result.settingsPath, removed: result.removed },
        options.context.format,
      );
    }),

    ensure: handled(async (options) => {
      const root = gitRoot();
      if (!root) {
        printResult(
          { ok: true, daemon: "skipped", reason: "not a git repo" },
          options.context.format,
        );
        return;
      }
      printResult({ ok: true, root, daemon: ensureDaemon(root) }, options.context.format);
    }),

    status: handled(async (options) => {
      const root = gitRoot();
      if (!root) {
        printResult({ ok: true, daemon: "none", reason: "not a git repo" }, options.context.format);
        return;
      }
      const pid = daemonPid(root);
      printResult(
        {
          ok: true,
          root,
          daemon: pid ? "running" : "stopped",
          ...(pid ? { pid, heartbeat_age_ms: Math.round(heartbeatAge(root)) } : {}),
          docs: scanDocs(root).length,
        },
        options.context.format,
      );
    }),

    stop: handled(async (options) => {
      const root = gitRoot();
      if (!root) {
        printResult({ ok: true, stopped: false, reason: "not a git repo" }, options.context.format);
        return;
      }
      const pid = stopDaemon(root);
      printResult(
        pid
          ? { ok: true, stopped: true, pid }
          : { ok: true, stopped: false, reason: "no running daemon" },
        options.context.format,
      );
    }),

    // Internal: the long-running process spawned by `ensure`. Logs go to the
    // file `ensure` redirected us to; we never print to the agent.
    run: handled(async (options) => {
      const root = resolve(options.input.root ?? gitRoot() ?? process.cwd());
      const handle = await startDaemon(root);
      if (!handle) process.exit(0); // another daemon owns this repo

      process.on("SIGTERM", () => void handle.stop());
      process.on("SIGINT", () => void handle.stop());

      await handle.stopped; // resolves on signal OR TTL self-reap
      process.exit(0);
    }),
  },
};
