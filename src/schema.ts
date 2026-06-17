import type { InferHandlers } from "argc";

import { toStandardJsonSchema } from "@valibot/to-json-schema";
import { c } from "argc";
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
        "Scan a directory of frontmatter-bearing markdown docs and emit an OKF index. Prints to stdout by default; --inject embeds it into a host file (e.g. AGENTS.md).",
      examples: [
        "claw index",
        "claw index --inject AGENTS.md",
        "claw index --dir docs --inject AGENTS.md",
      ],
    })
    .input(
      s(
        v.object({
          dir: v.optional(v.string()), // directory to scan; defaults to cwd
          inject: v.optional(v.string()), // host file to embed the index block in
          quiet: v.optional(v.boolean()), // suppress the summary line on --inject (for hook use)
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
  install: c
    .meta({
      description:
        "Wire `claw index --inject AGENTS.md` into this repo's agent hooks so the embedded index follows doc changes. Defaults to .claude/settings.local.json; --project for the shared settings.json.",
      examples: ["claw install", "claw install --project"],
    })
    .input(s(v.object({ project: v.optional(v.boolean()) }))),
  uninstall: c
    .meta({
      description:
        "Remove claw's hooks from this repo's agent settings (--project for the shared file).",
    })
    .input(s(v.object({ project: v.optional(v.boolean()) }))),
};

export type AppHandlers = InferHandlers<typeof schema, AppContext>;
