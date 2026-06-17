import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { stringify } from "yaml";

import type { Frontmatter } from "../frontmatter.ts";
import type { AppHandlers } from "../schema.ts";

import { notFoundError } from "../errors.ts";
import { parseFrontmatter } from "../frontmatter.ts";
import { handled } from "../handler.ts";
import { extractLinks, extractSections, renderToc, structuralSummary } from "../markdown.ts";
import { buildIndex, scanDocs } from "../wiki.ts";

// Above this body length the default read returns a structural summary instead
// of full content, to protect the agent's context budget.
const LONG_DOC_LINES = 200;

// Frontmatter keys surfaced back to the agent, in priority order.
const META_KEYS = [
  "type",
  "title",
  "description",
  "when",
  "status",
  "version",
  "timestamp",
  "tags",
] as const;

export const readHandlers: Pick<AppHandlers, "read"> = {
  read: handled(async (options) => {
    const input = options.input;
    const target = resolve(input.path);

    const stat = statSync(target, { throwIfNoEntry: false });
    if (!stat) {
      throw notFoundError(`Path not found: ${input.path}`, {
        hint: "Pass a markdown file or a directory.",
      });
    }

    if (stat.isDirectory()) {
      // Directory read = the same index `claw index` would print. The index
      // is computed on demand; there is no on-disk artifact to cache.
      write(buildIndex(scanDocs(target)).trimEnd());
      return;
    }

    const { data, body } = parseFrontmatter(readFileSync(target, "utf8"));

    if (input.toc) {
      write(renderToc(body));
      return;
    }
    if (input.section) {
      write(extractSections(body, input.section));
      return;
    }

    const lineCount = body.split("\n").length;
    const long = lineCount > LONG_DOC_LINES;
    const readHint = `claw read ${input.path} --section <n>`;

    const channel: Record<string, unknown> = pickMeta(data);
    const links = extractLinks(body);
    if (links.length > 0) channel.links = links;
    if (long) {
      channel.read = { toc: `claw read ${input.path} --toc`, section: readHint };
    }

    const content = long ? structuralSummary(body, readHint) : body.trim();
    write(clawFrontmatter(channel) + content);
  }),
};

function pickMeta(data: Frontmatter): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  for (const key of META_KEYS) {
    if (data[key] !== undefined) meta[key] = data[key];
  }
  return meta;
}

// `$claw` is the out-of-band tool→agent channel (navigation hints + the doc's
// own frontmatter), emitted as a YAML block that precedes the markdown content.
function clawFrontmatter(channel: Record<string, unknown>): string {
  if (Object.keys(channel).length === 0) return "";
  const yaml = stringify({ $claw: channel }).trimEnd();
  return `---\n${yaml}\n---\n\n`;
}

function write(content: string): void {
  process.stdout.write(content + "\n");
}
