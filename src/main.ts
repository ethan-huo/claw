#!/usr/bin/env bun

import { cli } from "argc";

import packageJson from "../package.json" with { type: "json" };
import { readHandlers } from "./handlers/read.ts";
import { schema } from "./schema.ts";

const app = cli(schema, {
  name: "claw",
  version: packageJson.version,
  description: "OKF-native knowledge reader for agent workspaces.",
});

await app.run({
  handlers: {
    ...readHandlers,
  },
});
