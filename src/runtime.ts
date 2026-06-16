import type { OutputFormat } from "./output.ts";

export type AppGlobals = {
  json?: boolean;
};

export type AppContext = {
  format: OutputFormat;
};

export function createContext(globals: AppGlobals): AppContext {
  return {
    format: globals.json ? "json" : "yaml",
  };
}
