# claw — agent guide

`claw` is a Bun + `argc` CLI: an OKF-style markdown knowledge reader.
One command — `read` — over a file or a directory.

## Conventions

- **Schema-first.** `src/schema.ts` is the public contract — command name,
  flags, examples, and help all live there. Change it deliberately.
- **Output is YAML** — for an agent to read, not a pipe to parse; there is no
  `--json` mode. Errors are structured (`src/errors.ts`) with exit codes
  2 (usage) / 3 (not found) / 4 (forbidden).
- **`bun run check`** (fmt:check + typecheck + test) must stay green. Use
  `oxfmt` and `tsgo`; never introduce eslint / prettier / tsc.

## Architecture

- Entry/wiring: `src/main.ts`. The command handler: `src/handlers/read.ts`.
  Everything else in `src/` is reusable logic.
- `wiki.ts` — `scanDocs` (enumerates via `git ls-files`, glob fallback) and
  `buildIndex` / `indexEntries` (a directory's index as YAML or plain records).
- `markdown.ts` — markdown-it backed `--toc` / `--section` / summary. Output is
  validated byte-for-byte against the `ctx` tool; keep it aligned.

## Invariants — don't break these silently

- **No on-disk index artifact.** A directory read computes its index live from
  frontmatter and prints to stdout. There is no `index.yaml`, no embedded
  block, no daemon — `claw` is a pure scan→output function.
- **`$claw:` is the tool→agent namespace.** Anything claw synthesizes (today
  the `size` hint; a file read's links/read-hints; tomorrow whatever else)
  lives under `$claw:`, never mixed with author frontmatter. Author
  frontmatter stays flat at the top of every index entry — that's the path an
  agent scans most.
- `scanDocs` indexes only frontmatter-bearing markdown. Dot-prefixed
  directories (`.git`, `.claw`, `.scratch`, `.agents`, `.claude`, …) are
  Unix-hidden infrastructure and are never indexed.
- A file read returns markdown (the `$claw` channel + body/summary); a
  directory read returns the index. `read` with no path indexes the cwd.
- Tests are the contract. Changing behavior without a test usually means it
  isn't locked.

## Knowledge

Run `claw read` for the live index of this tree. The one knowledge doc today is
the claw skill: `skills/claw/SKILL.md`.
