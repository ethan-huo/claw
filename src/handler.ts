import type { AppContext } from "./runtime.ts";

import { getExitCode } from "./errors.ts";
import { printError, type OutputFormat } from "./output.ts";

type HandlerOptions = {
  context?: AppContext;
};

function resolveFormat(options: HandlerOptions): OutputFormat {
  return options.context?.format ?? "yaml";
}

export function handled<TOptions extends HandlerOptions>(
  fn: (options: TOptions) => void | Promise<void>,
): (options: TOptions) => Promise<void> {
  return async (options: TOptions) => {
    try {
      await fn(options);
    } catch (error) {
      printError(error, resolveFormat(options));
      process.exitCode = getExitCode(error);
    }
  };
}
