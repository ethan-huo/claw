import { expect, test } from "bun:test";

import {
  extractLinks,
  extractSections,
  parseHeadings,
  renderToc,
  structuralSummary,
} from "./markdown.ts";

const DOC = [
  "# Intro",
  "hi",
  "",
  "# Design",
  "body",
  "",
  "## Detail",
  "deep",
  "",
  "# End",
  "bye",
].join("\n");

test("numbers headings hierarchically with subtree line counts", () => {
  const headings = parseHeadings(DOC);
  expect(headings.map((h) => `${h.number} ${h.text}`)).toEqual([
    "1 Intro",
    "2 Design",
    "2.1 Detail",
    "3 End",
  ]);
  // Design's subtree spans through its ## Detail child: lines 4..9.
  expect(headings[1]?.lineCount).toBe(6);
  expect(headings[2]?.lineCount).toBe(3);
});

test("recognizes setext headings (the parser, not regex)", () => {
  const headings = parseHeadings("Title\n=====\n\nbody\n\nSub\n---\nmore\n");
  expect(headings.map((h) => `${h.level} ${h.text}`)).toEqual(["1 Title", "2 Sub"]);
});

test("ignores headings in fenced and indented code blocks", () => {
  const fenced = parseHeadings("# Real\n```\n# Fake\n```\n## Also Real\n");
  expect(fenced.map((h) => h.text)).toEqual(["Real", "Also Real"]);

  const indented = parseHeadings("# Real\n\n    # Indented fake\n\n## Also Real\n");
  expect(indented.map((h) => h.text)).toEqual(["Real", "Also Real"]);
});

test("normalizes numbering to the shallowest heading level", () => {
  const headings = parseHeadings("## Top\n### Child\n## Top2\n");
  expect(headings.map((h) => h.number)).toEqual(["1", "1.1", "2"]);
});

test("renders a toc aligned with ctx: '<number> <text> (<count>)'", () => {
  expect(renderToc(DOC)).toBe(
    ["1 Intro (3)", "2 Design (6)", "2.1 Detail (3)", "3 End (2)"].join("\n"),
  );
});

test("extracts a section and its subtree by hierarchical number", () => {
  expect(extractSections(DOC, "2").trim()).toBe("# Design\nbody\n\n## Detail\ndeep");
});

test("extracts a nested section without siblings", () => {
  expect(extractSections(DOC, "2.1").trim()).toBe("## Detail\ndeep");
});

test("extracts an inclusive top-level range", () => {
  expect(extractSections(DOC, "1-2").trim()).toBe(
    "# Intro\nhi\n\n# Design\nbody\n\n## Detail\ndeep",
  );
});

test("preserves trailing blank lines in a section slice (matches ctx)", () => {
  expect(extractSections("# A\nx\n\n\n# B\ny\n", "1")).toBe("# A\nx\n\n");
});

test("throws not_found for an unmatched section", () => {
  expect(() => extractSections(DOC, "9")).toThrow(/No sections matched/);
});

test("throws usage error when the doc has no headings", () => {
  expect(() => extractSections("just prose\n", "1")).toThrow(/no headings/i);
});

test("collects markdown concept links, skipping non-md externals", () => {
  const body = "see [a](/x.md) and [b](./y.md) and [ext](https://z.com) and [c](w.md#frag)";
  expect(extractLinks(body)).toEqual(["/x.md", "./y.md", "w.md#frag"]);
});

test("summarizes a long document by section with a marker", () => {
  const long = Array.from({ length: 60 }, (_, i) => `line ${i}`);
  const doc = ["# A", ...long, "# B", ...long].join("\n");
  const summary = structuralSummary(doc, "claw read x --section <n>");
  expect(summary).toContain("[claw:summary]");
  expect(summary).toContain("1 A");
  expect(summary).toContain("2 B");
});

test("summarizes a headingless document with a line preview", () => {
  const doc = Array.from({ length: 40 }, (_, i) => `row ${i}`).join("\n");
  const summary = structuralSummary(doc, "hint");
  expect(summary).toContain("no sections");
  expect(summary).toContain("row 0");
});
