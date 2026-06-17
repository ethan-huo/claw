import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { stringify } from "yaml";

import { usageError } from "./errors.ts";
import { parseFrontmatter, type Frontmatter } from "./frontmatter.ts";

export type DocRecord = {
  path: string; // posix, relative to the scan root
  type: string;
  title: string;
  description?: string;
  when?: string;
  timestamp?: string;
  tags?: string[];
  data?: Frontmatter; // the doc's raw frontmatter, dumped verbatim into the index
};

// Build/VCS noise we never want in a knowledge index.
const IGNORED_SEGMENTS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".scratch",
  ".next",
  ".claw", // daemon state, never a concept
]);

// OKF reserves these filenames; they are structure, not concepts.
const RESERVED = new Set(["index.md", "log.md"]);

export const BLOCK_START = "<!-- claw:index -->";
export const BLOCK_END = "<!-- /claw:index -->";

// Soft cap on inlined pointers. Beyond this the block collapses to a single
// pointer line so an always-loaded file (AGENTS.md) stays bounded.
const POINTER_CAP = 60;

// Where installed/active skills live — the skill mechanism's territory. These
// are the only two; claw indexes nothing under them.
const SKILL_ROOTS = [".agents/skills/", ".claude/skills/"];

export function scanDocs(root: string): DocRecord[] {
  const records: DocRecord[] = [];

  for (const rel of listMarkdown(root)) {
    if (SKILL_ROOTS.some((dir) => rel.startsWith(dir))) continue;
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

    records.push(toRecord(rel, parsed.data));
  }

  records.sort((a, b) => a.path.localeCompare(b.path));
  return records;
}

// Enumerate candidate markdown as posix paths relative to root. In a git repo
// this is the authoritative `.gitignore`-respecting set (tracked + untracked,
// minus ignored); the daemon's coarse watch ignore never has to be exact. Falls
// back to a glob with a hardcoded ignore list outside a repo.
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
  if (git.exitCode === 0) {
    return [...new Set(git.stdout.toString().split("\0").filter(Boolean))];
  }

  const glob = new Glob("**/*.md");
  return [...glob.scanSync({ cwd: root, dot: true, onlyFiles: true })]
    .filter((rel) => !rel.split(sep).some((segment) => IGNORED_SEGMENTS.has(segment)))
    .map((rel) => rel.split(sep).join("/"));
}

function toRecord(path: string, data: Frontmatter): DocRecord {
  return {
    path,
    type: asString(data.type) ?? "Untyped",
    title: asString(data.title) ?? deriveTitle(path),
    description: asString(data.description),
    when: asString(data.when),
    timestamp: asString(data.timestamp),
    tags: Array.isArray(data.tags) ? data.tags.map((tag) => String(tag)) : undefined,
    data,
  };
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  return undefined;
}

function deriveTitle(path: string): string {
  const base = (path.split("/").pop() ?? path).replace(/\.md$/, "");
  return base
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// A real markdown file: an `# index.md` heading, then one entry per concept —
// `file: ./<path>` plus the doc's frontmatter verbatim — joined by `---`
// thematic breaks. The blank lines around the rule are required: `text\n---`
// would parse as a setext heading, not a divider.
export function buildIndex(docs: DocRecord[]): string {
  const head = "# index.md\n";
  if (docs.length === 0) return head;
  const entries = docs.map((doc) => stringify({ file: `./${doc.path}`, ...doc.data }).trimEnd());
  return `${head}\n${entries.join("\n\n---\n\n")}\n`;
}

function entry(doc: DocRecord): string {
  const summary = doc.description ?? doc.type;
  const trigger = doc.when ? ` _(when: ${doc.when})_` : "";
  return `[${doc.title}](${doc.path}) — ${summary}${trigger}`;
}

// A compact pointer index for injection into an always-loaded file. Pointers
// only (path + description + trigger) — never bodies — and it collapses past the
// cap so the host file cannot grow without bound.
export function buildPointerBlock(docs: DocRecord[], indexPath = "index.md"): string {
  const body =
    docs.length > POINTER_CAP
      ? `> ${docs.length} docs indexed — too many to inline. See [${indexPath}](${indexPath}).`
      : docs.map((doc) => `- ${entry(doc)}`).join("\n");

  return [
    BLOCK_START,
    "<!-- Generated by `claw index`. Edit the docs, not this block. -->",
    body,
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
