import type { AppHandlers } from "../schema.ts";

import { handled } from "../handler.ts";
import { installHooks, uninstallHooks } from "../hooks.ts";
import { printResult } from "../output.ts";

// Resolve the install target relative to the user's cwd. claw makes no attempt
// to locate a git root — hooks live next to the project the user is running in,
// not "the surrounding repo," and treating cwd as authoritative keeps install
// behavior identical inside and outside a git repo.
function root(): string {
  return process.cwd();
}

export const installHandlers: Pick<AppHandlers, "install" | "uninstall"> = {
  install: handled(async (options) => {
    const result = installHooks(root(), { project: options.input.project });
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
    const result = uninstallHooks(root(), { project: options.input.project });
    printResult(
      { ok: true, settings: result.settingsPath, removed: result.removed },
      options.context.format,
    );
  }),
};
