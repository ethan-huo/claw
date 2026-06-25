import type { InferHandlers } from "argc";

import { toStandardJsonSchema } from "@valibot/to-json-schema";
import { c } from "argc";
import * as v from "valibot";

const s = toStandardJsonSchema;

export const schema = {
  read: c
    .meta({
      description:
        "Read a markdown doc, or a directory's OKF index, with agent-optimized navigation. Path defaults to the current directory.",
      examples: [
        "claw read", // index of the current directory
        "claw read docs", // index of a directory
        "claw read docs/proposal.md",
        "claw read docs/proposal.md --toc",
        "claw read docs/proposal.md --section 2",
      ],
    })
    .args("path")
    .input(
      s(
        v.object({
          path: v.optional(v.string()), // file or directory; defaults to cwd
          toc: v.optional(v.boolean()), // OKF-wrapped heading outline with line counts
          section: v.optional(v.string()), // extract section(s): "2", "1.3", or "2-4"
        }),
      ),
    ),
};

export type AppHandlers = InferHandlers<typeof schema>;
