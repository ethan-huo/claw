import { statSync } from "node:fs";
import { relative, resolve } from "node:path";

import type { AppHandlers } from "../schema.ts";

import { notFoundError, usageError } from "../errors.ts";
import { handled } from "../handler.ts";
import { printResult } from "../output.ts";
import { reindex } from "../reindex.ts";

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

    // Resolve --inject against the scan root and keep it inside the tree — the
    // pointer block belongs with the docs it indexes, not some unrelated file.
    let inject: string | undefined;
    if (input.inject) {
      inject = resolve(root, input.inject);
      if (relative(root, inject).startsWith("..")) {
        throw usageError("--inject must stay inside the indexed directory.", {
          hint: "Pass a path relative to the scan root, e.g. --inject AGENTS.md.",
        });
      }
    }

    const result = reindex(root, { inject, dryRun: input.dryRun ?? false });

    printResult(
      { ok: true, scanned: result.scanned, wrote: result.wrote, dry_run: input.dryRun ?? false },
      options.context.format,
    );
  }),
};
