---
name: claw
description: >-
  Use when reading or indexing markdown knowledge in a workspace — listing what
  docs exist, navigating a long doc by section, embedding a fresh index into
  AGENTS.md — or when authoring any new doc (skill, proposal, issue, review,
  reference) so it follows the Open Knowledge Format (OKF).
---

`claw` treats a workspace's markdown as an OKF knowledge bundle: a directory of
docs, each with YAML frontmatter, discoverable through a generated index and
read with section-level precision. It does two things — **index** and **read** —
and it sets the convention for how every doc you write should look.

## Run it

`claw` is a CLI. Discover the surface before guessing flags:

```bash
claw --schema           # all commands, typed
claw --schema=.read     # one command's flags
```

### read — navigate a doc or a directory

```bash
claw read docs/proposal.md            # frontmatter ($claw channel) + full body (or a summary if long)
claw read docs/proposal.md --toc      # heading outline with line counts
claw read docs/proposal.md --section 2    # one section + its subtree ("2", "1.3", or a range "2-4")
claw read docs                        # a directory → its index (computed live from frontmatter)
```

The leading `$claw:` YAML block is the tool→agent channel: the doc's own
frontmatter (`type`, `when`, `timestamp`, …), the concept `links` it points at,
and — for long docs — how to read further. It is not part of the document body.
Long docs return a `[claw:summary]`; follow the `--section` hint instead of
re-reading the whole file.

### index — print or embed the index

```bash
claw index                            # print the index for the current directory tree to stdout
claw index --dir docs                 # index a specific directory
claw index --inject AGENTS.md         # embed the index inline in AGENTS.md
```

Each entry in the index carries a `size` hint like `"1234 tokens, 56 lines"`
(token count is a chars/4 estimate, ±15% on prose / markdown). Use it to
decide before reading: a small doc → read the whole body; a large doc →
go straight to `claw read … --toc` and drill in with `--section`.

Two delivery modes, one underlying scan:

- **stdout (default)** — call `claw index` whenever you need a fresh
  workspace map. No magic, no on-disk artifact.
- **`--inject`** — embed the full index inside a `<!-- claw:index -->` block
  in a host file (typically `AGENTS.md`). Why embed and not just point at a
  file? Because the agent's runtime surfaces edits to AGENTS.md through its
  file-change channel — so an inline index gives **passive awareness** as
  docs change, with no extra read. Idempotent: a no-op rebuild does not
  rewrite the file.

To keep the embedded index fresh automatically, run `claw install` once —
it wires `claw index --inject AGENTS.md --quiet` into the agent's lifecycle
hooks (`SessionStart`, `UserPromptSubmit`, `PostToolUse:Write|Edit|MultiEdit`).
Each call is a cheap synchronous scan; no background process, no state.

```bash
claw install            # one-time: auto-refresh AGENTS.md on doc changes
claw uninstall          # remove the hooks
```

Only **frontmatter-bearing** docs are indexed: a plain `README.md` or
`AGENTS.md` is not an OKF concept and is skipped, as are the reserved
`index.md` / `log.md`. Dot-prefixed directories (`.git`, `.claw`, `.scratch`,
`.agents`, `.claude`, …) are Unix-hidden infrastructure and never indexed.

## Author every doc in OKF format

This is the important part. Whenever you create a markdown doc in a workspace —
a proposal, an issue, a review, a skill, a reference note — **start it with YAML
frontmatter**. A doc without frontmatter is invisible to `claw index` and to any
agent scanning the bundle.

### The one rule and the principle

The only required field is `type`. Everything else you choose by asking:

> _What does a future reader — human or agent — need to know about this doc
> before opening it, to decide whether and when to read it?_

Encode those answers as frontmatter keys. Then write the body as **structural
markdown** (headings, lists, tables, fenced code) so `--toc`/`--section` can
navigate it, and link related docs with markdown links (`[name](/path.md)`).

### Conventional fields

| Field                | When to include it                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| `type`               | Always. A short descriptive kind: `Proposal`, `Issue`, `Review`, `Skill`, `Reference`, `Playbook`.           |
| `title`              | A human display name when the filename isn't enough.                                                         |
| `description`        | One sentence. This is what shows up in every index and preview — always worth writing.                       |
| `when`               | For load-on-demand knowledge (skills, playbooks): the _intent trigger_ that tells an agent to pull this doc. |
| `timestamp`          | When staleness matters (ISO 8601). Pairs with a `log.md` for history.                                        |
| `status` / `version` | For living documents that move through states or revisions.                                                  |
| `resource`           | A canonical URI when the doc describes an external asset.                                                    |
| `tags`               | Cross-cutting categorization.                                                                                |

### Typed starting points

These are _examples of the principle_, not a fixed registry. Invent a new
`type` whenever it helps — just give it the fields its readers will need.

```yaml
# skill — knowledge an agent loads on demand → it MUST carry an intent trigger
type: Skill
description: How to cut a release.
when: When the user asks to publish, tag, or ship a version.
```

```yaml
# proposal — a living document → version it and date it
type: Proposal
title: Unify memory and skills
status: draft # draft | accepted | superseded
version: 0.2
timestamp: 2026-06-16T00:00:00Z
```

```yaml
# issue — tracked work → state and categorization
type: Issue
title: read --section drops trailing newline
status: open # open | closed
tags: [bug, read]
timestamp: 2026-06-16T00:00:00Z
```

```yaml
# review — an assessment of something → point at what was reviewed and the verdict
type: Review
title: Review of proposal v0.2
resource: /docs/proposal.md
verdict: approve # approve | request-changes
timestamp: 2026-06-16T00:00:00Z
```

```yaml
# reference — a pointer to external material → carry the canonical URL
type: Reference
title: OKF spec
description: Open Knowledge Format conventions.
resource: https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/
```

After authoring or moving docs, the embedded index in AGENTS.md follows
automatically if `claw install` is wired up; otherwise run `claw index --inject
AGENTS.md` once.

## Feedback

File issues against the tool's repo when it fights you instead of working
around it:

```bash
gh issue create -R ethan-huo/claw --title "bug: <summary>" --body "<repro and output>"
```
