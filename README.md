# claw

OKF-native knowledge index and reader for agent workspaces.

`claw` treats a workspace's markdown as an [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
bundle — a directory of docs with YAML frontmatter — and gives an agent two
verbs over it:

- **`claw index`** — scan a tree of frontmatter docs and (re)generate an OKF
  `index.yaml`; optionally `--inject` a block into an always-loaded file like
  `AGENTS.md` (a static reference to `index.yaml` by default, or the full index
  with `--inline`). For continuous freshness, use `claw daemon` below.
- **`claw read`** — read a doc or a directory's index with agent-optimized
  navigation: a `$claw` frontmatter channel, `--toc`, `--section`, and a
  structural summary for long docs.
- **`claw daemon`** — a per-repo background watcher (anchored to the git root,
  kept alive by a heartbeat) that re-indexes on change. Wire `claw daemon ensure`
  to agent lifecycle hooks. See [docs/index-daemon.md](docs/index-daemon.md).

It also ships a skill (`skills/claw/SKILL.md`) that teaches agents to author
_every_ new doc in OKF format — the right frontmatter for skills (`when`),
proposals (`version`/`status`), issues, reviews, and references.

```bash
claw --schema                       # discover the surface
claw index --inject AGENTS.md       # build index.yaml + inject a pointer block
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
