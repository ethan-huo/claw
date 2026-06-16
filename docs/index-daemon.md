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
docs change, and in practice nobody does. We want indexes (`index.md` and the
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
- **Index layer (precise, authoritative):** the re-index itself enumerates docs
  via `git ls-files` ∪ `git ls-files --others --exclude-standard`, filtered to
  `*.md`. This is exact `.gitignore` semantics, for free.

Because git does the precise filtering at index time, the watcher's glob ignore
only needs to be _roughly_ right. An imperfect `.gitignore`→glob translation
(picomatch can't express `!` negation or every `**` anchoring rule) can at worst
trigger a redundant re-index that git then filters out. **It cannot produce wrong
output.** Correctness is pinned to the git layer.

Why `@parcel/watcher` over `node:fs` watch: `ignore` is a first-class, natively
pruned subscribe option (the filter is the first operator in the pipeline, not an
afterthought), C++ throttling immunizes against install storms, and it ships the
snapshot API below. Verified loading and pruning under Bun on macOS arm64.

## 3. Liveness by heartbeat TTL — not by tracking agent processes

The daemon must not outlive the sessions using it, but `SessionEnd` is
unreliable (a crash or `SIGKILL` skips it) and tracking agent PIDs is fiddly and
host-specific. Instead:

- Every frequently-firing hook (`SessionStart`, `UserPromptSubmit`,
  `PostToolUse`) runs `claw daemon ensure`, which (a) idempotently ensures the
  daemon is up and (b) `touch`es a heartbeat file.
- The daemon self-checks the heartbeat on a **low-frequency** timer (~10 min). If
  `now - mtime(heartbeat) > TTL` (~30 min), no one is active → it writes a final
  snapshot and exits.

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

## 4. Snapshot closes the gap a dead daemon would miss

`@parcel/watcher` can compute what changed while the program was **not running**:
`writeSnapshot(root, snap)` on exit, `getEventsSince(root, snap)` on start.

- Daemon writes a snapshot before exiting (TTL or clean stop).
- On the next `claw daemon ensure`, the daemon first replays
  `getEventsSince` to catch up everything that changed during its downtime — no
  full filesystem crawl — then enters live subscription.

Heartbeat TTL (die freely) + snapshot (dying loses nothing) compose exactly: the
daemon can be reaped or crash at any time with **zero missed changes** and no
cold-start rescan.

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

| Command              | Purpose                                                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `claw daemon ensure` | Resolve git root; start the daemon if absent (idempotent, lock-guarded); replay `getEventsSince`; touch heartbeat. The hook entry point. |
| `claw daemon status` | Report whether a daemon owns this repo: root, pid, uptime, heartbeat age, watched doc count.                                             |
| `claw daemon stop`   | Stop the daemon for this repo (eager teardown; writes a final snapshot).                                                                 |

`ensure` outside a git repo is a no-op that exits 0 (a non-repo directory is not a
daemon site) — hooks fire everywhere and must not error there.

# State layout

All daemon state lives under `.claw/` at the git root (add to `.gitignore`):

```
<git-root>/.claw/
├── daemon.lock      # pidfile of the daemon itself; staleness checked via kill(pid, 0)
├── heartbeat        # mtime = last time any session was active
└── snapshot         # @parcel/watcher snapshot for getEventsSince
```

The lock holds the **daemon's own** pid — `kill(pid, 0)` reliably distinguishes a
live owner from a stale lock. This is the one piece of process logic that remains,
and it is rock-solid, unlike tracking agent PIDs.

# Lifecycle

```
hook fires → claw daemon ensure
  ├─ root = git rev-parse --show-toplevel   (none → exit 0, no-op)
  ├─ acquire .claw/daemon.lock (O_EXCL)
  │    ├─ got it, or lock pid dead → spawn detached daemon:
  │    │     getEventsSince(snapshot) → re-index the gap
  │    │     subscribe(root, { ignore }) → debounce → claw index
  │    │     every ~10 min: heartbeat older than TTL? → writeSnapshot + exit
  │    └─ lock held by a live pid → daemon already running, do nothing
  └─ touch .claw/heartbeat
```

# Failure modes

| Failure                     | Outcome                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------- |
| Daemon crash / `SIGKILL`    | Stale lock; next `ensure` reclaims via `kill(pid,0)`; `getEventsSince` replays the gap. |
| `SessionEnd` never fires    | Heartbeat goes stale; daemon self-exits within ≤ TTL + tick.                            |
| Two sessions start at once  | `O_EXCL` lock elects one daemon; the loser just touches the heartbeat.                  |
| `npm install` churn         | C++ throttle/coalesce absorbs it; one debounced re-index, git filters the noise.        |
| Imperfect `.gitignore`→glob | At worst a redundant re-index; `git ls-files` keeps output correct.                     |
| Not a git repo              | No daemon; `ensure` is a no-op; `claw index` still works manually.                      |

# Deferred

- Eager teardown via live-agent-process scan (only if ≤ 40 min reaping ever feels
  too slow).
- Tuning TTL / tick / debounce intervals against real usage.
- Whether `claw index` should adopt the `git ls-files` enumeration now, ahead of
  the daemon, to unify the filter layer early.
