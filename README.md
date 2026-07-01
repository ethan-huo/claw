# claw

OKF-native knowledge reader for agent workspaces.

`claw` treats a workspace's markdown as an [Open Knowledge Format](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/)
bundle — a directory of docs with YAML frontmatter — and gives an agent one
verb over it: **`claw read`**, a pure scan→output function with no on-disk
artifact, no daemon, no host wiring.

- **`claw read <file>`** — read a doc with agent-optimized navigation: a
  `$claw` frontmatter channel, `--toc`, `--section`, and a structural summary
  for long docs.
- **`claw read <dir>`** (or no argument, for the cwd) — emit the directory's
  index as YAML, computed live from frontmatter.

It also ships a skill (`skills/claw/SKILL.md`) that teaches agents to author
_every_ new doc in OKF format — the right frontmatter for proposals
(`version`/`status`), issues, reviews, and references.

```bash
claw --schema                       # discover the surface
claw read                           # index the current directory
claw read docs                      # index a directory
claw read docs/proposal.md --toc    # outline a doc
claw read docs/proposal.md --section 2
claw read docs/proposal.md --section 1.1-2.1,3
```

## Install

Public repo:

```bash
curl -fsSL https://raw.githubusercontent.com/celados/claw/main/install.sh | bash
```

Private repo (requires an authenticated `gh` session; the script falls back
to `gh release download` automatically):

```bash
gh api repos/celados/claw/contents/install.sh --jq .content | base64 -d | bash
```

From source:

```bash
bun install
bun src/main.ts --help
```

## Develop

```bash
bun run check
bun run build
```

## Release

Bump `version` in package.json and push to main. The release workflow tags
vX.Y.Z and attaches the bundle automatically.

## Agent Skill

```text
skills/claw/SKILL.md
```
