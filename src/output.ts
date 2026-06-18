import { stringify } from "yaml";

import { toErrorPayload, type ErrorPayload } from "./errors.ts";

// Errors render as YAML — a readable summary an agent parses natively. claw has
// no machine-readable output mode: its index and doc reads are for an agent to
// read, not a pipe to parse.
export function printError(error: unknown): void {
  console.error(stringify(toErrorPayload(error)).trimEnd());
}

export type { ErrorPayload };
