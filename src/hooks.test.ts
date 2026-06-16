import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
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

function settings(root: string): Record<string, any> {
  return JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8"));
}

test("install creates settings.json and wires the three events", () => {
  const root = tmp();
  const result = installHooks(root);
  expect(result.created).toBe(true);
  expect(result.added).toEqual(["SessionStart", "UserPromptSubmit", "PostToolUse"]);

  const hooks = settings(root).hooks;
  expect(hooks.SessionStart[0].hooks[0].command).toBe("claw daemon ensure");
  expect(hooks.PostToolUse[0].matcher).toBe("Write|Edit|MultiEdit");
});

test("install is idempotent", () => {
  const root = tmp();
  installHooks(root);
  const second = installHooks(root);
  expect(second.added).toEqual([]);
  expect(second.alreadyPresent).toEqual(["SessionStart", "UserPromptSubmit", "PostToolUse"]);
  // exactly one entry per event, not duplicated
  expect(settings(root).hooks.SessionStart).toHaveLength(1);
});

test("install merges into existing settings without clobbering", () => {
  const root = tmp();
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(
    join(root, ".claude", "settings.json"),
    JSON.stringify({
      model: "opus",
      hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo hi" }] }] },
    }),
  );

  installHooks(root);
  const data = settings(root);
  expect(data.model).toBe("opus"); // preserved
  expect(data.hooks.SessionStart).toHaveLength(2); // existing + ours
  expect(data.hooks.SessionStart.some((g: any) => g.hooks[0].command === "echo hi")).toBe(true);
});

test("uninstall removes only claw hooks, leaving others", () => {
  const root = tmp();
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(
    join(root, ".claude", "settings.json"),
    JSON.stringify({
      hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo hi" }] }] },
    }),
  );
  installHooks(root);

  const result = uninstallHooks(root);
  expect(result.removed).toContain("SessionStart");
  const hooks = settings(root).hooks;
  expect(hooks.SessionStart).toHaveLength(1);
  expect(hooks.SessionStart[0].hooks[0].command).toBe("echo hi");
  expect(hooks.PostToolUse).toBeUndefined(); // ours removed entirely
});

test("install rejects an unparseable settings file", () => {
  const root = tmp();
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude", "settings.json"), "{ not json");
  expect(() => installHooks(root)).toThrow(/not valid JSON/);
});
