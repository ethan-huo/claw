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

    // Resolve --append against the scan root and keep it inside the tree — the
    // pointer block belongs with the docs it indexes, not some unrelated file.
    let append: string | undefined;
    if (input.append) {
      append = resolve(root, input.append);
      if (relative(root, append).startsWith("..")) {
        throw usageError("--append must stay inside the indexed directory.", {
          hint: "Pass a path relative to the scan root, e.g. --append AGENTS.md.",
        });
      }
    }

    const result = reindex(root, { append, dryRun: input.dryRun ?? false });

    printResult(
      { ok: true, scanned: result.scanned, wrote: result.wrote, dry_run: input.dryRun ?? false },
      options.context.format,
    );
  }),
};
