import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { usageError } from "./errors.ts";

// Wiring `claw daemon ensure` into agent lifecycle hooks is a setup step, not
// something the agent or the skill should reason about. This module owns the
// shape of that config so callers just run `claw daemon install`.

const HOOK_COMMAND = "claw daemon ensure";

const WIRING: ReadonlyArray<{ event: string; matcher?: string }> = [
  { event: "SessionStart" },
  { event: "UserPromptSubmit" },
  { event: "PostToolUse", matcher: "Write|Edit|MultiEdit" },
];

type HookCommand = { type: string; command: string };
type HookGroup = { matcher?: string; hooks: HookCommand[] };
type Settings = { hooks?: Record<string, HookGroup[]> } & Record<string, unknown>;

export type InstallResult = {
  settingsPath: string;
  created: boolean;
  added: string[];
  alreadyPresent: string[];
};

export type UninstallResult = {
  settingsPath: string;
  removed: string[];
};

function settingsPath(root: string): string {
  return join(root, ".claude", "settings.json");
}

function loadSettings(path: string): { settings: Settings; created: boolean } {
  if (!existsSync(path)) return { settings: {}, created: true };
  try {
    return { settings: JSON.parse(readFileSync(path, "utf8")) as Settings, created: false };
  } catch {
    throw usageError(`Cannot parse ${path}: not valid JSON.`, {
      hint: "Fix the settings file by hand, then re-run.",
    });
  }
}

function write(path: string, settings: Settings): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
}

function wired(groups: HookGroup[] | undefined): boolean {
  return (
    Array.isArray(groups) && groups.some((g) => g.hooks?.some((h) => h.command === HOOK_COMMAND))
  );
}

export function installHooks(root: string): InstallResult {
  const path = settingsPath(root);
  const { settings, created } = loadSettings(path);
  const hooks = (settings.hooks ??= {});

  const added: string[] = [];
  const alreadyPresent: string[] = [];
  for (const { event, matcher } of WIRING) {
    const groups = (hooks[event] ??= []);
    if (wired(groups)) {
      alreadyPresent.push(event);
      continue;
    }
    groups.push({
      ...(matcher ? { matcher } : {}),
      hooks: [{ type: "command", command: HOOK_COMMAND }],
    });
    added.push(event);
  }

  if (created || added.length > 0) write(path, settings);
  return { settingsPath: path, created, added, alreadyPresent };
}

export function uninstallHooks(root: string): UninstallResult {
  const path = settingsPath(root);
  if (!existsSync(path)) return { settingsPath: path, removed: [] };

  const { settings } = loadSettings(path);
  const removed: string[] = [];
  const hooks = settings.hooks ?? {};

  for (const event of Object.keys(hooks)) {
    const groups = hooks[event];
    if (!Array.isArray(groups) || !wired(groups)) continue;
    const kept = groups
      .map((g) => ({ ...g, hooks: g.hooks.filter((h) => h.command !== HOOK_COMMAND) }))
      .filter((g) => g.hooks.length > 0);
    if (kept.length > 0) hooks[event] = kept;
    else delete hooks[event];
    removed.push(event);
  }

  if (removed.length > 0) write(path, settings);
  return { settingsPath: path, removed };
}
