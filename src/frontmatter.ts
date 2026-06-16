import { parse } from "yaml";

export type Frontmatter = Record<string, unknown>;

export type ParsedDoc = {
  data: Frontmatter; // parsed frontmatter, {} when absent or malformed
  body: string; // everything after the frontmatter block
  hasFrontmatter: boolean;
};

// A frontmatter block is a YAML document fenced by `---` lines at the very
// start of the file. Malformed YAML is treated as "no frontmatter" so a single
// bad doc never blocks a scan.
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/;

export function parseFrontmatter(input: string): ParsedDoc {
  const text = normalize(input);
  const match = FRONTMATTER_RE.exec(text);
  if (!match) {
    return { data: {}, body: text, hasFrontmatter: false };
  }

  let data: Frontmatter = {};
  try {
    const parsed = parse(match[1] ?? "");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      data = parsed as Frontmatter;
    }
  } catch {
    return { data: {}, body: text, hasFrontmatter: false };
  }

  return { data, body: text.slice(match[0].length), hasFrontmatter: true };
}

function normalize(input: string): string {
  const withoutBom = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  return withoutBom.replace(/\r\n/g, "\n");
}
