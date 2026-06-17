# claw

OKF-native knowledge index and reader for agent workspaces.

`claw` treats a workspace's markdown as an [Open Knowledge Format](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/)
bundle — a directory of docs with YAML frontmatter — and gives an agent two
verbs over it:

- **`claw index`** — scan a tree of frontmatter-bearing docs and emit an index
  to stdout. With `--inject AGENTS.md`, embed the index inline into a host
  file so the agent's runtime (Claude Code, Codex) surfaces doc changes
  through its file-change channel. No on-disk index file; no daemon.
- **`claw read`** — read a doc or a directory's index with agent-optimized
  navigation: a `$claw` frontmatter channel, `--toc`, `--section`, and a
  structural summary for long docs.

Two helper commands wire `claw index --inject` into agent lifecycle hooks so
the embedded index follows doc changes automatically:

- **`claw install`** / **`claw uninstall`** — manage the hooks in
  `.claude/settings.local.json` (or `--project` for the shared
  `settings.json`). The hook command is a synchronous `claw index --inject
AGENTS.md --quiet` — idempotent, stateless, fast.

It also ships a skill (`skills/claw/SKILL.md`) that teaches agents to author
_every_ new doc in OKF format — the right frontmatter for skills (`when`),
proposals (`version`/`status`), issues, reviews, and references.

```bash
claw --schema                       # discover the surface
claw index                          # print the index to stdout
claw index --inject AGENTS.md       # embed the index inline in AGENTS.md
claw install                        # auto-refresh AGENTS.md on doc changes
claw read docs/proposal.md --toc    # outline a doc
claw read docs/proposal.md --section 2
```

## Install

Public repo:

```bash
curl -fsSL https://raw.githubusercontent.com/ethan-huo/claw/main/install.sh | bash
```

Private repo (requires an authenticated `gh` session; the script falls back
to `gh release download` automatically):

```bash
gh api repos/ethan-huo/claw/contents/install.sh --jq .content | base64 -d | bash
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
