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

export type BodyMeasure = {
  tokens: number;
  lines: number;
  size: string;
};

// Non-dot build noise we never want indexed. Dot-prefixed dirs are filtered by
// the Unix-hidden rule in `listMarkdown` and don't need to be listed here.
const IGNORED_DIRS = new Set(["node_modules", "dist", "build", "coverage"]);

// OKF reserves these filenames; they are structure, not concepts.
const RESERVED = new Set(["index.md", "log.md"]);

// A `SKILL.md` marks an agent skill: load-on-demand knowledge that belongs to
// the agent runtime (Claude Code, Codex), not to the project's OKF bundle.
// claw cedes the entire skill folder — SKILL.md itself, sibling notes, every
// nested file — so a workspace that ships its own skills doesn't see them
// pollute the index. Match is byte-exact: agent runtimes spell it `SKILL.md`,
// and being strict here means we don't catch a stray lowercase `skill.md` an
// author meant as a real concept.
const SKILL_FILENAME = "SKILL.md";

const TOKEN_WEIGHTS = {
  asciiAlnum: 0.22,
  asciiPunct: 0.6,
  whitespace: 0.05,
  cjk: 0.86,
  other: 1.1,
} as const;

export function scanDocs(root: string): DocRecord[] {
  const candidates = listMarkdown(root);

  // First pass: every directory that holds a SKILL.md becomes a forbidden
  // prefix. The trailing `/` is the boundary that keeps `skills/claw` from
  // shadowing `skills/claw-extras`.
  const skillRoots: string[] = [];
  for (const rel of candidates) {
    const slash = rel.lastIndexOf("/");
    const base = slash === -1 ? rel : rel.slice(slash + 1);
    if (base === SKILL_FILENAME) {
      const dir = slash === -1 ? "" : rel.slice(0, slash);
      // dir === "" means the scan root itself is a skill — the whole tree is
      // ceded, deliberately. A SKILL.md at the root is rare; when it shows up,
      // the user's intent is "this entire workspace is a skill folder".
      skillRoots.push(dir === "" ? "" : `${dir}/`);
    }
  }

  const records: DocRecord[] = [];

  for (const rel of candidates) {
    if (skillRoots.some((prefix) => prefix === "" || rel.startsWith(prefix))) continue;

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

    records.push({ path: rel, size: measureBody(parsed.body).size, data: parsed.data });
  }

  records.sort((a, b) => a.path.localeCompare(b.path));
  return records;
}

// Body-size hint surfaced in the index so an agent can decide, before reading,
// whether to grab the whole doc or jump straight to --toc / --section.
//
// Fast tokenizer-shaped estimate. The old chars/4 rule undercounted Chinese
// markdown by roughly half; full BPE counting was accurate but made large
// indexes scale with tokenizer CPU. These weights are a deliberately small
// character-class model calibrated against o200k_base on mixed English,
// Chinese, and markdown docs. The leading `~` remains because this is body-only
// and excludes YAML wrapper plus model/tool-call overhead.
export function measureBody(body: string): BodyMeasure {
  const tokens = estimateTokens(body);
  // Match the line-counting convention in markdown.ts: a trailing newline
  // doesn't add a "line", so --section and `size` agree on what line N means.
  const lines = body.length === 0 ? 0 : body.split("\n").length - (body.endsWith("\n") ? 1 : 0);
  return { tokens, lines, size: `~${tokens} tokens, ${lines} lines` };
}

function estimateTokens(text: string): number {
  let estimate = 0;

  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x7f) {
      if (isAsciiAlnum(code)) estimate += TOKEN_WEIGHTS.asciiAlnum;
      else if (isAsciiWhitespace(code)) estimate += TOKEN_WEIGHTS.whitespace;
      else estimate += TOKEN_WEIGHTS.asciiPunct;
    } else if (isCjkLike(code)) {
      estimate += TOKEN_WEIGHTS.cjk;
    } else {
      estimate += TOKEN_WEIGHTS.other;
    }
  }

  return Math.ceil(estimate);
}

function isAsciiAlnum(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    code === 0x5f ||
    (code >= 0x61 && code <= 0x7a)
  );
}

function isAsciiWhitespace(code: number): boolean {
  return code === 0x20 || (code >= 0x09 && code <= 0x0d);
}

function isCjkLike(code: number): boolean {
  return (
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0x3400 && code <= 0x9fff) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0x20000 && code <= 0x2ebef)
  );
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
