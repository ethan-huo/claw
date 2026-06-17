import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import type { AppHandlers } from "../schema.ts";

import { notFoundError, usageError } from "../errors.ts";
import { handled } from "../handler.ts";
import { printResult } from "../output.ts";
import { buildIndex, indexBlock, injectManagedBlock, scanDocs } from "../wiki.ts";

export const indexHandlers: Pick<AppHandlers, "index"> = {
  index: handled(async (options) => {
    const input = options.input;
    const root = resolve(input.dir ?? ".");

    const stat = statSync(root, { throwIfNoEntry: false });
    if (!stat?.isDirectory()) {
      throw notFoundError(`Not a directory: ${input.dir ?? "."}`, {
        hint: "Point claw index at a folder of markdown docs.",
      });
    }

    const docs = scanDocs(root);

    // No --inject: stdout is the canonical channel — the agent calls claw and
    // gets the index. No magic file on disk.
    if (!input.inject) {
      process.stdout.write(buildIndex(docs));
      return;
    }

    // --inject: embed the index into the host file (e.g. AGENTS.md), so the
    // agent's host (Claude Code, Codex) surfaces changes through its
    // file-change channel without an explicit tool call.
    const inject = resolve(root, input.inject);
    if (relative(root, inject).startsWith("..")) {
      throw usageError("--inject must stay inside the indexed directory.", {
        hint: "Pass a path relative to the scan root, e.g. --inject AGENTS.md.",
      });
    }

    const block = indexBlock(docs);
    const previous = existsSync(inject) ? readFileSync(inject, "utf8") : "";
    const next = injectManagedBlock(previous, block);
    // Skip the write when content is unchanged — a hook firing every turn
    // would otherwise churn the host file's mtime for no reason.
    const changed = next !== previous;
    if (changed) writeFileSync(inject, next);

    if (input.quiet) return;
    printResult(
      {
        ok: true,
        scanned: docs.length,
        injected: relative(process.cwd(), inject) || inject,
        changed,
      },
      options.context.format,
    );
  }),
};
