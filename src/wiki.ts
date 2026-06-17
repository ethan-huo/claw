import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { stringify } from "yaml";

import { usageError } from "./errors.ts";
import { parseFrontmatter, type Frontmatter } from "./frontmatter.ts";

// The index entry an agent navigates by: a path, a body-size hint, and the
// doc's frontmatter dumped verbatim. We deliberately don't normalize/derive
// frontmatter fields — agents read the YAML; fabricated metadata would mislead
// them. `size` is the one synthesized field, because no human writes it
// accurately and an agent reads the index expressly to decide whether to
// fetch full body or jump straight to --toc/--section.
export type DocRecord = {
  path: string; // posix, relative to the scan root
  size: string; // body-size hint, e.g. "1234 tokens, 56 lines"
  data: Frontmatter;
};

// Non-dot build noise we never want indexed. Dot-prefixed dirs are filtered by
// the Unix-hidden rule in `listMarkdown` and don't need to be listed here.
const IGNORED_DIRS = new Set(["node_modules", "dist", "build", "coverage"]);

// OKF reserves these filenames; they are structure, not concepts.
const RESERVED = new Set(["index.md", "log.md"]);

export const BLOCK_START = "<!-- claw:index -->";
export const BLOCK_END = "<!-- /claw:index -->";

export function scanDocs(root: string): DocRecord[] {
  const records: DocRecord[] = [];

  for (const rel of listMarkdown(root)) {
    const base = rel.split("/").pop() ?? "";
    if (RESERVED.has(base)) continue;

    let text: string;
    try {
      text = readFileSync(join(root, rel), "utf8");
    } catch {
      continue;
    }

    // Only frontmatter-bearing docs are OKF concepts. Plain files (README,
    // AGENTS.md, notes) are not indexed — which also keeps a pointer-block host
    // file from listing itself.
    const parsed = parseFrontmatter(text);
    if (!parsed.hasFrontmatter) continue;

    records.push({ path: rel, size: bodySize(parsed.body), data: parsed.data });
  }

  records.sort((a, b) => a.path.localeCompare(b.path));
  return records;
}

// Body-size hint surfaced in the index so an agent can decide, before reading,
// whether to grab the whole doc or jump straight to --toc / --section.
//
// Token estimation uses the canonical no-tokenizer rule of thumb of ~4 chars
// per token — accurate to ±15% on English prose / markdown for any major LLM
// tokenizer (cl100k, BPE-based, etc.). Good enough for "is this huge?"; we
// trade exactness for zero dependencies and zero per-doc overhead.
function bodySize(body: string): string {
  const tokens = Math.ceil(body.length / 4);
  // Match the line-counting convention in markdown.ts: a trailing newline
  // doesn't add a "line", so --section and `size` agree on what line N means.
  const lines = body.length === 0 ? 0 : body.split("\n").length - (body.endsWith("\n") ? 1 : 0);
  return `${tokens} tokens, ${lines} lines`;
}

// Enumerate candidate markdown as posix paths relative to root. In a git repo
// this is the authoritative `.gitignore`-respecting set (tracked + untracked,
// minus ignored); the daemon's coarse watch ignore never has to be exact. Falls
// back to a glob with a hardcoded ignore list outside a repo. Either way we
// drop dot-prefixed segments — Unix-hidden dirs are infrastructure (.git,
// .claw, .agents, .claude, .next, .scratch …), never knowledge to surface.
function listMarkdown(root: string): string[] {
  const git = Bun.spawnSync(
    [
      "git",
      "-C",
      root,
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      "*.md",
    ],
    { stderr: "ignore" },
  );

  const candidates =
    git.exitCode === 0
      ? [...new Set(git.stdout.toString().split("\0").filter(Boolean))]
      : [...new Glob("**/*.md").scanSync({ cwd: root, dot: true, onlyFiles: true })]
          .filter((rel) => !rel.split(sep).some((segment) => IGNORED_DIRS.has(segment)))
          .map((rel) => rel.split(sep).join("/"));

  return candidates.filter((rel) => !rel.split("/").some((seg) => seg.startsWith(".")));
}

// The index is a YAML list — one entry per concept, `file` + `size` plus the
// doc's frontmatter verbatim. `size` sits next to `file` because it's tool-
// derived metadata about the file, distinct from author-written frontmatter.
// Spread order lets a hand-written `data.size` win — same principle that keeps
// us from synthesizing other fields.
export function buildIndex(docs: DocRecord[]): string {
  return stringify(docs.map((doc) => ({ file: `./${doc.path}`, size: doc.size, ...doc.data })));
}

// The injected block: the full index, fenced so a markdown formatter leaves
// the embedded YAML alone. Embedding gives the agent passive awareness through
// the host's file-change channel — a static reference would force the agent to
// read a second file, no better than just calling `claw index` on demand.
//
// Blank lines around the fenced block are deliberate: oxfmt and most CommonMark
// formatters insert them anyway, and emitting them ourselves keeps the block
// idempotent against any hook → formatter → hook ping-pong.
export function indexBlock(docs: DocRecord[]): string {
  return [
    BLOCK_START,
    "<!-- Generated by `claw index --inject`. Edit the docs, not this block. -->",
    "",
    "```yaml",
    buildIndex(docs).trimEnd(),
    "```",
    "",
    BLOCK_END,
  ].join("\n");
}

export function injectManagedBlock(content: string, block: string): string {
  const start = content.indexOf(BLOCK_START);
  const end = content.indexOf(BLOCK_END);

  if (start !== -1 && end !== -1 && end > start) {
    return content.slice(0, start) + block + content.slice(end + BLOCK_END.length);
  }

  // A lone or out-of-order marker means a corrupted block. Appending another
  // would compound the damage — refuse and let the user fix it.
  if (start !== -1 || end !== -1) {
    throw usageError("Refusing to update: unbalanced claw:index markers in the target file.", {
      hint: "Remove the stray <!-- claw:index --> / <!-- /claw:index --> marker, then re-run.",
    });
  }

  if (content.length === 0) return block + "\n";
  const gap = content.endsWith("\n\n") ? "" : content.endsWith("\n") ? "\n" : "\n\n";
  return content + gap + block + "\n";
}
