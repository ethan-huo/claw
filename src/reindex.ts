import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { buildIndex, buildPointerBlock, injectManagedBlock, scanDocs } from "./wiki.ts";

export type ReindexResult = {
  scanned: number;
  wrote: string[];
};

export type ReindexOptions = {
  inject?: string; // absolute path to inject a pointer block into (e.g. AGENTS.md)
  dryRun?: boolean;
};

// The single write path shared by `claw index` and the daemon: scan frontmatter
// docs, regenerate the root index.md, and optionally refresh a pointer block.
export function reindex(root: string, options: ReindexOptions = {}): ReindexResult {
  const docs = scanDocs(root);
  const wrote: string[] = [];

  const indexPath = join(root, "index.md");
  if (!options.dryRun) writeFileSync(indexPath, buildIndex(docs));
  wrote.push(show(indexPath));

  if (options.inject) {
    const previous = existsSync(options.inject) ? readFileSync(options.inject, "utf8") : "";
    const next = injectManagedBlock(previous, buildPointerBlock(docs));
    if (!options.dryRun) writeFileSync(options.inject, next);
    wrote.push(show(options.inject));
  }

  return { scanned: docs.length, wrote };
}

function show(path: string): string {
  return relative(process.cwd(), path) || path;
}
