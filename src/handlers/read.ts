import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { stringify } from "yaml";

import type { Frontmatter } from "../frontmatter.ts";
import type { AppHandlers } from "../schema.ts";

import { notFoundError } from "../errors.ts";
import { parseFrontmatter } from "../frontmatter.ts";
import { handled } from "../handler.ts";
import { extractLinks, extractSections, renderToc, structuralSummary } from "../markdown.ts";
import { buildIndex, measureBody, scanDocs } from "../wiki.ts";

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
    const path = input.path ?? "."; // default to the current directory's index
    const target = resolve(path);

    const stat = statSync(target, { throwIfNoEntry: false });
    if (!stat) {
      throw notFoundError(`Path not found: ${path}`, {
        hint: "Pass a markdown file or a directory.",
      });
    }

    if (stat.isDirectory()) {
      // A directory's natural reading IS its index — computed live from
      // frontmatter, no on-disk artifact.
      write(buildIndex(scanDocs(target)).trimEnd());
      return;
    }

    const { data, body } = parseFrontmatter(readFileSync(target, "utf8"));

    if (input.toc) {
      write(clawFrontmatter(tocChannel(body)) + renderToc(body));
      return;
    }
    if (input.section) {
      write(extractSections(body, input.section));
      return;
    }

    const lineCount = body.split("\n").length;
    const long = lineCount > LONG_DOC_LINES;
    const readHint = `claw read ${path} --section <n>`;

    const channel: Record<string, unknown> = pickMeta(data);
    const links = extractLinks(body);
    if (links.length > 0) channel.links = links;
    if (long) {
      channel.read = { toc: `claw read ${path} --toc`, section: readHint };
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

function tocChannel(body: string): Record<string, unknown> {
  const measure = measureBody(body);
  return { size: measure.size };
}

// `$claw` is the out-of-band tool→agent channel, emitted as a YAML block that
// precedes markdown content without becoming part of the document body.
function clawFrontmatter(channel: Record<string, unknown>): string {
  if (Object.keys(channel).length === 0) return "";
  const yaml = stringify({ $claw: channel }).trimEnd();
  return `---\n${yaml}\n---\n\n`;
}

function write(content: string): void {
  process.stdout.write(content + "\n");
}
