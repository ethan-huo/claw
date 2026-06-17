#!/usr/bin/env bun

import { cli } from "argc";

import packageJson from "../package.json" with { type: "json" };
import { indexHandlers } from "./handlers/index-cmd.ts";
import { installHandlers } from "./handlers/install.ts";
import { readHandlers } from "./handlers/read.ts";
import { createContext } from "./runtime.ts";
import { globalsSchema, schema } from "./schema.ts";

const app = cli(schema, {
  name: "claw",
  version: packageJson.version,
  description: "OKF-native knowledge index and reader for agent workspaces.",
  globals: globalsSchema,
  context: createContext,
});

await app.run({
  handlers: {
    ...indexHandlers,
    ...readHandlers,
    ...installHandlers,
  },
});
