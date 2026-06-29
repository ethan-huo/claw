---
name: claw
description: >
  Use whenever you work with markdown knowledge in this workspace — reading or
  navigating a doc by section, listing what docs exist via a directory's index,
  or authoring and editing a doc so it follows the Open Knowledge Format (OKF):
  YAML frontmatter and a structural body. Backs the `claw read` CLI and the OKF
  convention every doc here should carry.
---

`claw` treats a workspace's markdown as an OKF knowledge bundle: a directory of
docs, each with YAML frontmatter, discoverable through a live index and read
with section-level precision. It has one command — **read** — over a file or a
directory, and it sets the convention for how every doc you write should look.

## Run it

`claw` is a CLI. Discover the surface before guessing flags:

```bash
claw --schema           # the command, typed
```

### read a directory → its index

```bash
claw read                             # index the current directory tree
claw read docs                        # index a specific directory
```

A directory's natural reading is its **index**: a YAML list, one entry per
frontmatter-bearing doc, carrying the doc's `file`, a `$claw:` block of
tool-synthesized metadata (today: a `size` hint), and the doc's frontmatter
verbatim. It is computed live on every read — there is no on-disk index file
to go stale. Use the `$claw.size` hint (e.g. `"~1234 tokens, 56 lines"` — the
leading `~` flags it as a calibrated body-only estimate, not a full prompt
invoice) to decide before reading: a small doc → read the whole body; a large
doc → go straight to `--toc` and drill in with `--section`.

Anything claw synthesizes lives under `$claw:`, never mixed in with the
author's frontmatter — the namespace separation is permanent, so a doc that
happens to declare its own `size: tiny` keeps it intact.

Only **frontmatter-bearing** docs are indexed: a plain `README.md` or
`AGENTS.md` is not an OKF concept and is skipped, as are the reserved
`index.md` / `log.md`. Dot-prefixed directories (`.git`, `.claw`, `.scratch`,
`.agents`, `.claude`, …) are Unix-hidden infrastructure and never indexed.

**Skill folders are also ceded.** Any directory containing a `SKILL.md` —
that file plus every sibling and every nested file — drops out of the index.
A skill is load-on-demand knowledge owned by the agent runtime (Claude Code,
Codex), not part of the project's OKF bundle. You can still read a skill
file directly with `claw read path/to/SKILL.md`; it just doesn't appear in
any directory index.

### read a file → its content

```bash
claw read docs/proposal.md            # frontmatter ($claw channel) + full body (or a summary if long)
claw read docs/proposal.md --toc      # OKF-wrapped heading outline with line counts
claw read docs/proposal.md --section 2    # one section + its subtree ("2", "1.3", or a range "2-4")
```

The leading `$claw:` YAML block is the tool→agent channel. A full file read
surfaces the doc's own frontmatter (`type`, `title`, `description`, …), concept
links extracted from the body (`.md` hrefs), and — for long docs — how to read
further. A `--toc` read surfaces `$claw.size`, then the heading outline as the
body. The block is not part of the document body. Long docs return a
`[claw:summary]`; follow the `--section` hint instead of re-reading the whole
file.

## Author every doc in OKF format

This is the important part. Whenever you create a markdown doc in a workspace —
a proposal, an issue, a review, a reference note — **start it with YAML
frontmatter**. A doc without frontmatter is invisible to the index and to any
agent scanning the bundle.

### The one rule and the principle

The only required field is `type`. Everything else you choose by asking:

> _What does a future reader — human or agent — need to know about this doc
> before opening it, to decide whether and when to read it?_

Encode those answers as frontmatter keys. Then write the body as **structural
markdown** (headings, lists, tables, fenced code) so `--toc`/`--section` can
navigate it, and link related docs with markdown links (`[name](/path.md)`).

For any value past a few words, use a block scalar (`>` folds, `|` keeps
newlines) instead of quoting and escaping — it's the safe way to avoid broken
frontmatter:

```yaml
description: >
  Anything goes here — colons, "quotes", #hashes — no escaping needed.
```

### Conventional fields

| Field                | When to include it                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| `type`               | Always. A short descriptive kind: `Proposal`, `Issue`, `Review`, `Reference`, `Playbook`.                      |
| `title`              | A human display name when the filename isn't enough.                                                           |
| `description`        | One sentence. This is what shows up in every index and preview — always worth writing.                         |
| `when`               | For load-on-demand knowledge (playbooks, runbooks): the _intent trigger_ that tells an agent to pull this doc. |
| `timestamp`          | When staleness matters (ISO 8601). Pairs with a `log.md` for history.                                          |
| `status` / `version` | For living documents that move through states or revisions.                                                    |
| `resource`           | A canonical URI when the doc describes an external asset.                                                      |
| `tags`               | Cross-cutting categorization.                                                                                  |

### Typed starting points

These are _examples of the principle_, not a fixed registry. Invent a new
`type` whenever it helps — just give it the fields its readers will need.

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

A new doc shows up in the directory index the moment it has frontmatter — `claw
read` recomputes the index on every call, so there is nothing to refresh.

### Sidecars

When a doc is _about_ another doc — a review of a proposal, notes on an issue,
a critique of a reference — name it as a **sidecar**: `<doc>.<kind>.md`, living
next to its subject. The filename itself encodes the relation; the frontmatter
points back with `resource:`.

```
docs/
  proposal.md            # type: Proposal, version: 0.3
  proposal.review.md     # type: Review,   resource: ./proposal.md
  proposal.notes.md      # type: Notes,    resource: ./proposal.md
```

A sidecar is a **living document**, not an append-only log. When your review
evolves — the proposal changed, your verdict shifted, you found new issues —
**bump `version` and rewrite the content in place**. Do _not_ spawn
`proposal.review.v2.md` or `proposal.review-2026-06-29.md`; that fragments the
conversation and pollutes the index.

```yaml
---
type: Review
title: Review of proposal
resource: ./proposal.md
verdict: request-changes # approve | request-changes
version: 0.3
timestamp: 2026-06-29T00:00:00Z
---
```

One sidecar file per (subject, kind) pair.

## Feedback

File issues against the tool's repo when it fights you instead of working
around it:

```bash
gh issue create -R celados/claw --title "bug: <summary>" --body "<repro and output>"
```
