import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { installHooks, uninstallHooks } from "./hooks.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true });
});

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "claw-hooks-"));
  dirs.push(dir);
  return dir;
}

// install defaults to the user-local, gitignored file.
function localSettings(root: string): Record<string, any> {
  return JSON.parse(readFileSync(join(root, ".claude", "settings.local.json"), "utf8"));
}

function writeLocal(root: string, data: unknown): void {
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude", "settings.local.json"), JSON.stringify(data));
}

test("install defaults to settings.local.json and wires the three events", () => {
  const root = tmp();
  const result = installHooks(root);
  expect(result.created).toBe(true);
  expect(result.settingsPath.endsWith(".claude/settings.local.json")).toBe(true);
  expect(result.added).toEqual(["SessionStart", "UserPromptSubmit", "PostToolUse"]);

  const hooks = localSettings(root).hooks;
  expect(hooks.SessionStart[0].hooks[0].command).toBe("claw index --inject AGENTS.md --quiet");
  expect(hooks.PostToolUse[0].matcher).toBe("Write|Edit|MultiEdit");
  // the shared (committed) file is left untouched
  expect(existsSync(join(root, ".claude", "settings.json"))).toBe(false);
});

test("install --project targets the shared settings.json", () => {
  const root = tmp();
  const result = installHooks(root, { project: true });
  expect(result.settingsPath.endsWith(".claude/settings.json")).toBe(true);
  expect(existsSync(join(root, ".claude", "settings.local.json"))).toBe(false);
});

test("install is idempotent", () => {
  const root = tmp();
  installHooks(root);
  const second = installHooks(root);
  expect(second.added).toEqual([]);
  expect(second.alreadyPresent).toEqual(["SessionStart", "UserPromptSubmit", "PostToolUse"]);
  expect(localSettings(root).hooks.SessionStart).toHaveLength(1); // not duplicated
});

test("install merges into existing settings without clobbering", () => {
  const root = tmp();
  writeLocal(root, {
    model: "opus",
    hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo hi" }] }] },
  });

  installHooks(root);
  const data = localSettings(root);
  expect(data.model).toBe("opus"); // preserved
  expect(data.hooks.SessionStart).toHaveLength(2); // existing + ours
  expect(data.hooks.SessionStart.some((g: any) => g.hooks[0].command === "echo hi")).toBe(true);
});

test("uninstall removes only claw hooks, leaving others", () => {
  const root = tmp();
  writeLocal(root, {
    hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo hi" }] }] },
  });
  installHooks(root);

  const result = uninstallHooks(root);
  expect(result.removed).toContain("SessionStart");
  const hooks = localSettings(root).hooks;
  expect(hooks.SessionStart).toHaveLength(1);
  expect(hooks.SessionStart[0].hooks[0].command).toBe("echo hi");
  expect(hooks.PostToolUse).toBeUndefined(); // ours removed entirely
});

test("install rejects an unparseable settings file", () => {
  const root = tmp();
  writeLocal(root, "" as never); // write raw invalid json below
  writeFileSync(join(root, ".claude", "settings.local.json"), "{ not json");
  expect(() => installHooks(root)).toThrow(/not valid JSON/);
});
