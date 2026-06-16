import type { InferHandlers } from "argc";

import { toStandardJsonSchema } from "@valibot/to-json-schema";
import { c, group } from "argc";
import * as v from "valibot";

import type { AppContext } from "./runtime.ts";

const s = toStandardJsonSchema;

export const globalsSchema = s(
  v.object({
    json: v.optional(v.boolean()), // raw JSON for jq pipes; default output is YAML
  }),
);

export const schema = {
  index: c
    .meta({
      description:
        "Scan a directory of markdown docs and (re)generate an OKF index.md from their frontmatter.",
      examples: ["claw index", "claw index --append AGENTS.md", "claw index --dir docs"],
    })
    .input(
      s(
        v.object({
          dir: v.optional(v.string()), // directory to scan; defaults to cwd
          append: v.optional(v.string()), // also inject a pointer block into this file
          dryRun: v.optional(v.boolean()), // report changes without writing
        }),
      ),
    ),
  read: c
    .meta({
      description: "Read a markdown doc (or a directory's index) with agent-optimized navigation.",
      examples: [
        "claw read docs/proposal.md",
        "claw read docs/proposal.md --toc",
        "claw read docs/proposal.md --section 2",
      ],
    })
    .args("path")
    .input(
      s(
        v.object({
          path: v.string(),
          toc: v.optional(v.boolean()), // heading outline with line counts
          section: v.optional(v.string()), // extract section(s): "2", "1.3", or "2-4"
        }),
      ),
    ),
  daemon: group(
    { description: "Manage the per-repo index daemon that keeps indexes fresh on change." },
    {
      install: c
        .meta({
          description:
            "Wire `claw daemon ensure` into this repo's agent hooks (.claude/settings.json), creating or merging the file. Run once to enable auto-indexing.",
          examples: ["claw daemon install"],
        })
        .input(s(v.object({}))),
      uninstall: c
        .meta({ description: "Remove claw's hooks from this repo's .claude/settings.json." })
        .input(s(v.object({}))),
      ensure: c
        .meta({
          description:
            "Ensure the index daemon is running for this repo and refresh its heartbeat. The hook entry point; a no-op outside a git repo.",
          examples: ["claw daemon ensure"],
        })
        .input(s(v.object({}))),
      status: c
        .meta({ description: "Report the index daemon's status for this repo." })
        .input(s(v.object({}))),
      stop: c.meta({ description: "Stop the index daemon for this repo." }).input(s(v.object({}))),
      run: c
        .meta({ description: "Internal: run the daemon in the foreground (spawned by ensure)." })
        .input(s(v.object({ root: v.optional(v.string()) }))),
    },
  ),
};

export type AppHandlers = InferHandlers<typeof schema, AppContext>;
