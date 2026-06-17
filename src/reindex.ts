import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { buildIndex, inlineBlock, injectManagedBlock, referenceBlock, scanDocs } from "./wiki.ts";

export type ReindexResult = {
  scanned: number;
  wrote: string[];
};

export type ReindexOptions = {
  inject?: string; // absolute path to inject an index block into (e.g. AGENTS.md)
  inline?: boolean; // embed the full index instead of a reference to index.yaml
  dryRun?: boolean;
};

// The single write path shared by `claw index` and the daemon: scan frontmatter
// docs, regenerate the root index.yaml, and optionally refresh a pointer block.
export function reindex(root: string, options: ReindexOptions = {}): ReindexResult {
  const docs = scanDocs(root);
  const wrote: string[] = [];

  const indexPath = join(root, "index.yaml");
  if (!options.dryRun) writeFileSync(indexPath, buildIndex(docs));
  wrote.push(show(indexPath));

  if (options.inject) {
    const block = options.inline ? inlineBlock(docs) : referenceBlock();
    const previous = existsSync(options.inject) ? readFileSync(options.inject, "utf8") : "";
    const next = injectManagedBlock(previous, block);
    // Skip the write when nothing changed — the reference block is static, so a
    // daemon re-running this every change shouldn't churn the file's mtime.
    if (!options.dryRun && next !== previous) writeFileSync(options.inject, next);
    wrote.push(show(options.inject));
  }

  return { scanned: docs.length, wrote };
}

function show(path: string): string {
  return relative(process.cwd(), path) || path;
}
