import { expect, test } from "bun:test";

import { parseFrontmatter } from "./frontmatter.ts";

test("parses frontmatter and separates the body", () => {
  const { data, body, hasFrontmatter } = parseFrontmatter(
    "---\ntype: Reference\ntitle: OKF\n---\n# Body\ntext\n",
  );
  expect(hasFrontmatter).toBe(true);
  expect(data).toEqual({ type: "Reference", title: "OKF" });
  expect(body).toBe("# Body\ntext\n");
});

test("treats a missing block as no frontmatter", () => {
  const { data, body, hasFrontmatter } = parseFrontmatter("# Just a heading\n");
  expect(hasFrontmatter).toBe(false);
  expect(data).toEqual({});
  expect(body).toBe("# Just a heading\n");
});

test("malformed YAML degrades to no frontmatter, body intact", () => {
  const input = "---\ntype: [unclosed\n---\n# Body\n";
  const { data, body, hasFrontmatter } = parseFrontmatter(input);
  expect(hasFrontmatter).toBe(false);
  expect(data).toEqual({});
  expect(body).toBe(input);
});

test("normalizes CRLF and strips a BOM", () => {
  const { data, body } = parseFrontmatter("﻿---\r\ntype: Note\r\n---\r\nbody\r\n");
  expect(data).toEqual({ type: "Note" });
  expect(body).toBe("body\n");
});

test("a fence-like line in the body is not mistaken for frontmatter close", () => {
  const { data } = parseFrontmatter("---\ntype: Note\nwhen: use --- as a separator\n---\nbody\n");
  expect(data).toEqual({ type: "Note", when: "use --- as a separator" });
});
