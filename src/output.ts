import { stringify } from "yaml";

import { toErrorPayload, type ErrorPayload } from "./errors.ts";

// Default to YAML: a readable summary an agent parses natively. --json is the
// raw-data escape hatch for jq pipes. `read` output is markdown and bypasses
// this renderer entirely — it writes content straight to stdout.
export type OutputFormat = "yaml" | "json";

export function renderOutput(data: unknown, format: OutputFormat): string {
  if (format === "json") {
    return JSON.stringify(data, null, 2);
  }

  return stringify(data).trimEnd();
}

export function printResult(data: unknown, format: OutputFormat): void {
  console.log(renderOutput(data, format));
}

export function printError(error: unknown, format: OutputFormat): void {
  console.error(renderOutput(toErrorPayload(error), format));
}

export type { ErrorPayload };
