---
type: Proposal
title: Index daemon — auto-maintained indexes via agent hooks
description: How claw keeps indexes fresh without manual runs, using a git-rooted watch daemon driven by agent lifecycle hooks.
status: accepted
version: 1.0
tags: [daemon, hooks, watch, okf]
timestamp: 2026-06-16T00:00:00Z
---

# Problem

`claw index` is a one-shot. Someone — the agent or a human — has to run it after
docs change, and in practice nobody does. We want indexes (`index.yaml` and the
`AGENTS.md` pointer block) to stay fresh on their own.

The mechanism is a per-repo **index daemon** that watches for changes and
re-indexes, started and kept alive by agent **lifecycle hooks** (Claude Code,
Codex). The daemon is `claw`'s third command; this doc is the design we
converged on. Implementation lands separately.

# Non-goals

- **Refreshing already-loaded context mid-session.** When claw rewrites
  `AGENTS.md`, surfacing that change to the model is the agent host's job — Claude
  Code already pushes out-of-band file-change diffs for files it tracks. Out of
  scope. See [agent hooks reference](/docs/agent-hooks-reference.md).
- **`CLAUDE.md` ⇄ `AGENTS.md` linkage.** The daemon writes the standard
  `AGENTS.md` only. Making Claude Code see it (symlink `CLAUDE.md → AGENTS.md`, or
  an `@AGENTS.md` import) is the user's concern, not the tool's.
- **Cross-platform.** macOS only. We rely on FSEvents and do not design around
  Linux/Windows watch backends.

# Decisions

## 1. The git repo root is the anchor — there is no parent search

The daemon's watch root is always `git rev-parse --show-toplevel`. Every session
anywhere inside the repo resolves to the **same** root, so it ensures the **same
single daemon**.

This deletes an entire class of complexity we previously considered: there is no
N-level ancestor walk, no depth cap, no "does a parent daemon's scope cover me"
coverage math. One repo, one well-known daemon location.

- Nested repos / submodules / worktrees each have their own `--show-toplevel`,
  hence their own daemon. Correct, not a bug.
- A directory that is not a git repo gets no daemon. `claw index` can still be
  run there by hand.

## 2. Two-layer filtering: a coarse watch prune, a precise index filter

`.gitignore` is honored, but the two layers have different jobs and only one is
authoritative.

- **Watch layer (coarse, performance):** [`@parcel/watcher`](https://github.com/parcel-bundler/watcher)
  `subscribe(root, cb, { ignore })`. The `ignore` globs (`node_modules/**`,
  `.git/**`, `dist/**`, plus top-level `.gitignore` dirs) prune entire subtrees
  **in C++ before any event reaches JS**. Events are throttled and coalesced in
  C++, so a `git checkout` or `npm install` storm cannot overwhelm the JS thread.
- **Index layer (precise, authoritative):** `scanDocs` enumerates docs via
  `git ls-files --cached --others --exclude-standard -- '*.md'` (tracked +
  untracked, minus ignored), falling back to a glob outside a git repo. This is
  exact `.gitignore` semantics, for free — implemented, not deferred.

Because git does the precise filtering at index time, the watcher's glob ignore
only needs to be _roughly_ right. An imperfect `.gitignore`→glob translation
(picomatch can't express `!` negation or every `**` anchoring rule) can at worst
trigger a redundant re-index that git then filters out. **It cannot produce wrong
output.** Correctness is pinned to the git layer.

Why `@parcel/watcher` over `node:fs` watch: `ignore` is a first-class, natively
pruned subscribe option (the filter is the first operator in the pipeline, not an
afterthought), and C++ throttling immunizes against install storms. Verified
loading and pruning under Bun on macOS arm64.

## 3. Liveness by heartbeat TTL — not by tracking agent processes

The daemon must not outlive the sessions using it, but `SessionEnd` is
unreliable (a crash or `SIGKILL` skips it) and tracking agent PIDs is fiddly and
host-specific. Instead:

- Every frequently-firing hook (`SessionStart`, `UserPromptSubmit`,
  `PostToolUse`) runs `claw daemon ensure`, which (a) idempotently ensures the
  daemon is up and (b) `touch`es a heartbeat file.
- The daemon self-checks the heartbeat on a **low-frequency** timer (~10 min). If
  `now - mtime(heartbeat) > TTL` (~30 min), no one is active → it exits.

Properties:

- **No PID tracking, no `ps`/`lsof`, no process identification.** Any agent —
  Claude Code or Codex — keeps the daemon alive simply by its hooks touching the
  heartbeat. Tool-agnostic.
- **No dependence on `SessionEnd`.** Crash, `SIGKILL`, closed terminal — the
  zombie dies within ≤ TTL + tick (~40 min). Slow teardown is acceptable; we
  agreed eager teardown is not required.
- **Self-healing.** If a long idle lets the TTL reap the daemon, the next action's
  `ensure` brings it back.

> Eager teardown, if ever wanted, is an optional add-on: a low-frequency scan for
> live agent processes whose cwd is under the root. Not in v1.

## 4. Startup does a full rescan — no snapshot bookkeeping

An earlier draft used `@parcel/watcher`'s snapshot API (`writeSnapshot` /
`getEventsSince`) to catch changes missed while the daemon was dead. We dropped
it: a reindex is already a **full** `scanDocs(root)`, not an incremental update,
so a snapshot only gates the boolean "should I reindex on startup?" — and the
answer is always yes. Doing one full reindex on startup catches every offline
change for free, with no extra persisted state and no failure surface.

This is the "least machinery" call: the snapshot bought nothing a one-line full
rescan doesn't already give, given the index is regenerated wholesale anyway.

## 5. Hook wiring

`Stop` is **not** session end — it fires every turn. The teardown hook is
`SessionEnd`. (See [agent hooks reference](/docs/agent-hooks-reference.md) §2.1.)

```jsonc
// .claude/settings.json
"hooks": {
  "SessionStart":      [{ "hooks": [{ "type": "command", "command": "claw daemon ensure" }] }],
  "UserPromptSubmit":  [{ "hooks": [{ "type": "command", "command": "claw daemon ensure" }] }],
  "PostToolUse":       [{ "matcher": "Write|Edit|MultiEdit",
                          "hooks": [{ "type": "command", "command": "claw daemon ensure" }] }]
  // SessionEnd is optional: `claw daemon stop` for eager teardown. The TTL
  // handles it regardless, so this hook is not load-bearing.
}
```

`claw daemon ensure` is the single entry point hooks call. It is cheap and
idempotent: resolve the git root, ensure the daemon, touch the heartbeat.

# Command contract

| Command                 | Purpose                                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `claw daemon install`   | Wire `claw daemon ensure` into agent hooks. Defaults to the gitignored `.claude/settings.local.json`; `--project` for shared. |
| `claw daemon ensure`    | Resolve git root; start the daemon if absent (idempotent, lock-guarded); touch heartbeat. The hook entry point.               |
| `claw daemon status`    | Report whether a daemon owns this repo: root, pid, heartbeat age, watched doc count.                                          |
| `claw daemon stop`      | Stop the daemon for this repo (eager teardown).                                                                               |
| `claw daemon uninstall` | Remove claw's hooks from the agent settings.                                                                                  |

`ensure` outside a git repo is a no-op that exits 0 (a non-repo directory is not a
daemon site) — hooks fire everywhere and must not error there.

# State layout

All daemon state lives under `.claw/` at the git root (add to `.gitignore`):

```
<git-root>/.claw/
├── daemon.lock      # pid + process start time of the daemon itself
├── heartbeat        # mtime = last time any session was active
└── daemon.log       # detached daemon's stdout/stderr
```

The lock holds the daemon's **pid + start time** — `kill(pid, 0)` plus a
start-time match distinguishes a live owner from a stale lock _and_ from an
unrelated process that reused the pid after a crash. This is the one piece of
process logic that remains, and it is robust, unlike tracking agent PIDs.

# Lifecycle

```
hook fires → claw daemon ensure
  ├─ root = git rev-parse --show-toplevel   (none → exit 0, no-op)
  ├─ live daemon owns the lock? → do nothing
  ├─ else spawn detached daemon:
  │     acquire .claw/daemon.lock (O_EXCL, pid + start time)
  │     full reindex on startup → catches anything changed while down
  │     subscribe(root, { ignore }) → debounce → reindex
  │     every ~10 min: repo gone / lost lock / heartbeat past TTL? → exit
  └─ touch .claw/heartbeat
```

# Failure modes

| Failure                     | Outcome                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| Daemon crash / `SIGKILL`    | Stale lock; next `ensure` reclaims via pid+start-time check; startup rescan replays the gap. |
| `SessionEnd` never fires    | Heartbeat goes stale; daemon self-exits within ≤ TTL + tick.                                 |
| Two sessions start at once  | `O_EXCL` lock elects one daemon; the loser just touches the heartbeat.                       |
| Repo deleted under a daemon | Watch callback and reaper see the vanished `.claw` dir and exit — never spin on a dead path. |
| `npm install` churn         | C++ throttle/coalesce absorbs it; one debounced re-index, git filters the noise.             |
| Imperfect `.gitignore`→glob | At worst a redundant re-index; `git ls-files` keeps output correct.                          |
| Not a git repo              | No daemon; `ensure` is a no-op; `claw index` still works manually.                           |

# Deferred

- Eager teardown via live-agent-process scan (only if ≤ 40 min reaping ever feels
  too slow).
- Tuning TTL / tick / debounce intervals against real usage.
- Whether to keep the daemon at all vs. running `claw index` synchronously from
  the same hooks. The daemon earns its place only for changes made _outside_ the
  agent's own edits (other editors, another agent, `git pull`); for the
  agent-is-sole-writer case, synchronous indexing is simpler. Revisit with data.
