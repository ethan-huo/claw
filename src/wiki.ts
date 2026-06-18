import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { stringify } from "yaml";

import { parseFrontmatter, type Frontmatter } from "./frontmatter.ts";

// The index entry an agent navigates by: a path, a body-size hint (tool-
// synthesized), and the doc's frontmatter dumped verbatim. We deliberately
// don't normalize/derive author frontmatter — agents read the YAML; fabricated
// metadata would mislead them. The size hint is necessary because an agent
// reads the index expressly to decide whether to fetch full body or jump
// straight to --toc/--section, but it's *tool* metadata, not author intent —
// so it lives in the `$claw` namespace, never mixed with frontmatter keys.
export type DocRecord = {
  path: string; // posix, relative to the scan root
  size: string; // body-size hint, e.g. "~1234 tokens, 56 lines"
  data: Frontmatter;
};

// Non-dot build noise we never want indexed. Dot-prefixed dirs are filtered by
// the Unix-hidden rule in `listMarkdown` and don't need to be listed here.
const IGNORED_DIRS = new Set(["node_modules", "dist", "build", "coverage"]);

// OKF reserves these filenames; they are structure, not concepts.
const RESERVED = new Set(["index.md", "log.md"]);

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
// trade exactness for zero dependencies and zero per-doc overhead. The leading
// `~` makes the approximation explicit at the surface — readers should not
// take this number as exact.
function bodySize(body: string): string {
  const tokens = Math.ceil(body.length / 4);
  // Match the line-counting convention in markdown.ts: a trailing newline
  // doesn't add a "line", so --section and `size` agree on what line N means.
  const lines = body.length === 0 ? 0 : body.split("\n").length - (body.endsWith("\n") ? 1 : 0);
  return `~${tokens} tokens, ${lines} lines`;
}

// Enumerate candidate markdown as posix paths relative to root. In a git repo
// this is the authoritative `.gitignore`-respecting set (tracked + untracked,
// minus ignored). Falls back to a glob with a hardcoded ignore list outside a
// repo. Either way we drop dot-prefixed segments — Unix-hidden dirs are
// infrastructure (.git, .claw, .agents, .claude, .next, .scratch …), never
// knowledge to surface.
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

// The index a directory read prints: a YAML list, one entry per concept.
// `file` is the concept's identity (OKF: the path *is* the concept) and stays
// at the top level. `$claw` carries everything tool-synthesized — today just
// `size`, tomorrow whatever else we surface — so it can never collide with an
// author's frontmatter key. The doc's own frontmatter spreads in flat at the
// end: an agent's most common scan is "read the description, decide whether
// to open" — sinking it into a sub-key would tax that path for no reason.
export function buildIndex(docs: DocRecord[]): string {
  return stringify(
    docs.map((doc) => ({ file: `./${doc.path}`, $claw: { size: doc.size }, ...doc.data })),
  );
}
