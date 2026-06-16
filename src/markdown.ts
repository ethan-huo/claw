import MarkdownIt from "markdown-it";

import { notFoundError, usageError } from "./errors.ts";

export type Heading = {
  level: number; // 1-6
  text: string; // raw heading source text
  line: number; // 1-based line of the heading within the body
  number: string; // hierarchical section number, e.g. "1.2"
  lineCount: number; // lines in this heading's subtree, heading line included
};

// CommonMark parsing via markdown-it. We only consume heading structure; tokens
// carry `.map` (source line ranges), so headings are detected correctly —
// setext, fenced/indented code, HTML blocks — and section reads still slice the
// original source text rather than re-rendering from an AST.
const md = MarkdownIt();

export function parseHeadings(body: string): Heading[] {
  const tokens = md.parse(body, {});
  const totalLines = countLines(body);

  const headings: Heading[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const open = tokens[i];
    if (open?.type !== "heading_open" || !open.map) continue;
    const inline = tokens[i + 1];
    headings.push({
      level: Number(open.tag.slice(1)), // "h2" → 2
      text: inline?.type === "inline" ? inline.content : "",
      line: open.map[0] + 1, // token.map is 0-based
      number: "",
      lineCount: 0,
    });
  }

  assignNumbers(headings);
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    if (heading) heading.lineCount = subtreeEnd(headings, i, totalLines) - heading.line + 1;
  }
  return headings;
}

// Number by position in the heading tree, not by raw level: each heading is one
// rung deeper than its nearest shallower ancestor, regardless of how many levels
// it skips. So `##` → `#####` is one step (1.2.1), not four (1.2.1.1.1). On
// well-nested docs this equals the literal depth and matches ctx.
function assignNumbers(headings: Heading[]): void {
  const stack: Array<{ level: number; counter: number }> = [];
  for (const heading of headings) {
    while (stack.length > 0 && stack[stack.length - 1]!.level > heading.level) stack.pop();
    const top = stack[stack.length - 1];
    if (top && top.level === heading.level) {
      top.counter += 1; // sibling
    } else {
      stack.push({ level: heading.level, counter: 1 }); // first child at a new rung
    }
    heading.number = stack.map((entry) => entry.counter).join(".");
  }
}

// The last line (inclusive, 1-based) of a heading's subtree: up to the line
// before the next heading of equal-or-shallower level, else end of document.
function subtreeEnd(headings: Heading[], index: number, totalLines: number): number {
  const current = headings[index];
  if (!current) return totalLines;
  for (let j = index + 1; j < headings.length; j++) {
    const next = headings[j];
    if (next && next.level <= current.level) return next.line - 1;
  }
  return totalLines;
}

function countLines(body: string): number {
  if (body.length === 0) return 0;
  const count = body.split("\n").length;
  return body.endsWith("\n") ? count - 1 : count; // trailing newline isn't a line
}

// Aligned with `ctx read --toc`: "<number> <text> (<subtree line count>)".
export function renderToc(body: string): string {
  const headings = parseHeadings(body);
  if (headings.length === 0) return "(no headings)";
  return headings.map((h) => `${h.number} ${h.text} (${h.lineCount})`).join("\n");
}

// Select sections by hierarchical number ("1.2"), by top-level number ("3"), or
// by an inclusive top-level range ("2-4"). A match pulls in the whole subtree.
export function extractSections(body: string, expr: string): string {
  const headings = parseHeadings(body);
  if (headings.length === 0) {
    throw usageError("Document has no headings to select.", {
      hint: "Read the file without --section.",
    });
  }

  const lines = body.split("\n");
  const ranges = selectRanges(headings, expr.trim(), countLines(body));
  if (ranges.length === 0) {
    throw notFoundError(`No sections matched "${expr}".`, {
      hint: "Run with --toc to list available sections.",
      details: { sections: headings.map((h) => h.number) },
    });
  }

  // Faithful source slice — trailing blank lines preserved, matching ctx.
  return ranges.map(([start, end]) => lines.slice(start - 1, end).join("\n")).join("\n");
}

function selectRanges(
  headings: Heading[],
  expr: string,
  totalLines: number,
): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const range = /^(\d+)-(\d+)$/.exec(expr);

  if (range) {
    const lo = Math.min(Number(range[1]), Number(range[2]));
    const hi = Math.max(Number(range[1]), Number(range[2]));
    for (let i = 0; i < headings.length; i++) {
      const heading = headings[i];
      if (!heading || heading.number.includes(".")) continue; // top-level only
      const n = Number(heading.number);
      if (n >= lo && n <= hi) ranges.push([heading.line, subtreeEnd(headings, i, totalLines)]);
    }
    return ranges;
  }

  for (let i = 0; i < headings.length; i++) {
    if (headings[i]?.number === expr) {
      ranges.push([headings[i]!.line, subtreeEnd(headings, i, totalLines)]);
    }
  }
  return ranges;
}

// A compressed view of a long document: every heading kept, each section
// previewed by a few non-empty lines proportional to its size. Forces the agent
// to --section into what it needs instead of slurping the whole file.
export function structuralSummary(body: string, readHint: string): string {
  const lines = body.split("\n");
  const headings = parseHeadings(body);

  if (headings.length === 0) {
    const preview = lines.slice(0, 30).join("\n").trimEnd();
    return `[claw:summary] ${lines.length} lines, no sections.\n\n${preview}`;
  }

  const parts = [
    `[claw:summary] ${countLines(body)} lines, ${headings.length} sections. Read one with: ${readHint}`,
  ];

  for (const heading of headings) {
    const previewCount = Math.max(2, Math.min(5, Math.floor(heading.lineCount / 10)));
    const sectionBody = lines
      .slice(heading.line, heading.line + heading.lineCount - 1)
      .filter((line) => line.trim().length > 0)
      .slice(0, previewCount);
    const title = `${heading.number} ${heading.text} (${heading.lineCount})`;
    parts.push(sectionBody.length > 0 ? `${title}\n${sectionBody.join("\n")}` : title);
  }

  return parts.join("\n\n");
}

// Concept links: bundle-relative (`/x.md`, `./x.md`) or any `.md` target.
// External non-markdown URLs are ignored. Parsed from tokens, not regex.
export function extractLinks(body: string): string[] {
  const links = new Set<string>();
  const walk = (tokens: ReturnType<typeof md.parse>): void => {
    for (const token of tokens) {
      if (token.type === "link_open") {
        const href = token.attrGet("href");
        if (href && (/\.md($|#)/.test(href) || href.startsWith("/"))) links.add(href);
      }
      if (token.children) walk(token.children);
    }
  };
  walk(md.parse(body, {}));
  return [...links];
}
