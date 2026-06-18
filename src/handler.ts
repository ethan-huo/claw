import { getExitCode } from "./errors.ts";
import { printError } from "./output.ts";

export function handled<TOptions>(
  fn: (options: TOptions) => void | Promise<void>,
): (options: TOptions) => Promise<void> {
  return async (options: TOptions) => {
    try {
      await fn(options);
    } catch (error) {
      printError(error);
      process.exitCode = getExitCode(error);
    }
  };
}
