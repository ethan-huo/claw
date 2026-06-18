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
  `buildIndex` (a YAML list, one entry per concept).
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
- **A `SKILL.md` cedes its directory.** Any folder that holds a `SKILL.md`
  (and every nested file beneath it) drops out of the index — skills are
  load-on-demand knowledge owned by the agent runtime, not concepts in this
  workspace's OKF bundle. `read` against a SKILL.md path still works; only
  the directory scan defers. Match is byte-exact (`SKILL.md`); a lowercase
  `skill.md` is a regular doc.
- A file read returns markdown (the `$claw` channel + body/summary); a
  directory read returns the index. `read` with no path indexes the cwd.
- Tests are the contract. Changing behavior without a test usually means it
  isn't locked.

## Knowledge

This workspace has no project-level OKF concept docs — everything human-facing
lives in `README.md` / this guide / `skills/claw/SKILL.md`, and the SKILL.md
cede rule keeps the skill out of the index. So `claw read` against this tree
is empty by design; that's the dogfood. The knowledge file an agent should
read on entry is the skill: `skills/claw/SKILL.md`.
