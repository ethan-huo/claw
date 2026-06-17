---
name: claw
description: >-
  Use when reading or indexing markdown knowledge in a workspace — listing what
  docs exist, navigating a long doc by section, regenerating an index.md — or
  when authoring any new doc (skill, proposal, issue, review, reference) so it
  follows the Open Knowledge Format (OKF).
---

`claw` treats a workspace's markdown as an OKF knowledge bundle: a directory of
docs, each with YAML frontmatter, discoverable through generated indexes and
read with section-level precision. It does two things — **index** and **read** —
and it sets the convention for how every doc you write should look.

## Run it

`claw` is a CLI. Discover the surface before guessing flags:

```bash
claw --schema           # both commands, typed
claw --schema=.read     # one command's flags
```

### read — navigate a doc or a directory

```bash
claw read docs/proposal.md            # frontmatter ($claw channel) + full body (or a summary if long)
claw read docs/proposal.md --toc      # heading outline with line counts
claw read docs/proposal.md --section 2    # one section + its subtree ("2", "1.3", or a range "2-4")
claw read docs                        # a directory → its index.md (synthesized if absent)
```

The leading `$claw:` YAML block is the tool→agent channel: the doc's own
frontmatter (`type`, `when`, `timestamp`, …), the concept `links` it points at,
and — for long docs — how to read further. It is not part of the document body.
Long docs return a `[claw:summary]`; follow the `--section` hint instead of
re-reading the whole file.

### index — (re)generate the index

```bash
claw index                            # write index.md for the current directory tree
claw index --dir docs                 # index a specific directory
claw index --inject AGENTS.md         # also inject a pointer block into an always-loaded file
claw index --dry-run                  # report what would change, write nothing
```

(To rebuild automatically on every change, use the daemon below instead of
re-running `claw index`.)

`--inject` maintains a `<!-- claw:index -->…<!-- /claw:index -->` block of
pointers (path + description + `when`), so an always-loaded file gains ambient
awareness of the wiki without inlining doc bodies. The block stays
pointer-only and collapses to a single line once it grows past a soft cap.

Only **frontmatter-bearing** docs are indexed. A plain `README.md` or
`AGENTS.md` is not an OKF concept and is skipped. `index.md` and `log.md` are
reserved filenames. A directory containing a `SKILL.md` is a skill bundle —
that's the skill mechanism's territory, so claw indexes nothing inside it.

### daemon — keep the index fresh automatically

In a git repo, a background daemon can re-index on every change so you never run
`claw index` by hand. Enable it once, then it runs itself:

```bash
claw daemon install   # one-time: wire auto-indexing into this repo's agent hooks
claw daemon status    # pid, heartbeat age, watched doc count
claw daemon stop      # stop it for this repo
```

`claw daemon install` is the setup step — it configures the agent integration for
you (idempotent; safe to re-run). After that the daemon starts and stays fresh on
its own. Design: [index daemon](/docs/index-daemon.md).

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
resource: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md
```

After authoring or moving docs, run `claw index` so the indexes stay in sync.

## Feedback

File issues against the tool's repo when it fights you instead of working
around it:

```bash
gh issue create -R ethan-huo/claw --title "bug: <summary>" --body "<repro and output>"
```
