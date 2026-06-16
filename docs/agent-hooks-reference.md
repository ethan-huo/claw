# Agent Hook 机制参考：Claude Code & Codex CLI

> 用途：claw 在未来设计自己的 hook / 自动化扩展能力时的外部参考上下文。
> 这里记录的是「别人怎么做的」，不是 claw 的设计决定。
>
> 调查时间：2026-06-16。
> 可信度分级：Claude Code 部分来自官方文档原文，可信；Codex 部分机制结论可信，
> 但具体 PR 号 / 版本号 / 精确日期来自二手检索，引用前请回源核对。

---

## TL;DR

- 两者都支持**项目级 hooks**，都是「分层配置、就近覆盖」模型。
- **Claude Code 的 hook 体系成熟得多**：30+ 个 hook 点，`PreToolUse` 能直接改写工具入参，还有「个人不共享」的 `.local.json` 层。
- **Codex 较新**：只有 6 个事件，刻意对齐了 Claude 的命名；项目级 hooks 有「信任门槛」，且 `PreToolUse` 还不能改入参。
- 跨两个 agent 做统一钩子层时，**取交集**最稳：
  `SessionStart / UserPromptSubmit / PreToolUse(只做 allow/deny) / PostToolUse / Stop`
  这 5 个两边都有且语义一致。

---

## 1. 配置层级与项目级支持

### 1.1 Claude Code

四个 scope，优先级 **Managed > CLI 参数 > Local > Project > User**：

| Scope       | 路径                                               | 范围               | 是否共享             |
| ----------- | -------------------------------------------------- | ------------------ | -------------------- |
| Managed     | 系统级（MDM/plist/registry/managed-settings.json） | 全机器所有用户     | 是（IT 部署）        |
| User        | `~/.claude/settings.json`                          | 你的所有项目       | 否                   |
| **Project** | `.claude/settings.json`                            | 当前仓库所有协作者 | 是（可 commit）      |
| **Local**   | `.claude/settings.local.json`                      | 当前仓库，仅你自己 | 否（自动 gitignore） |

合并规则要点：

- 大多数键是**覆盖**（高优先级整体替换低优先级）。
- **例外：`permissions.allow/deny` 是跨 scope 叠加合并**，不是覆盖。
- 多数配置（含 `permissions`、`hooks`）**热加载**，改完即生效；`model`、`outputStyle` 等少数键需重启。

官方文档：https://code.claude.com/docs/en/settings.md

### 1.2 Codex CLI

优先级（高→低）：**CLI 参数 > 项目级 > Profile > User > 系统级 > 内置默认**

| 层级        | 路径                                                            | 格式        |
| ----------- | --------------------------------------------------------------- | ----------- |
| 系统/企业   | `/etc/codex/config.toml`、`requirements.toml`（不可被用户禁用） | TOML        |
| 用户全局    | `~/.codex/config.toml` / `~/.codex/hooks.json`                  | TOML / JSON |
| Profile     | `~/.codex/<profile>.config.toml`（`--profile` 选择）            | TOML        |
| **项目级**  | `<repo>/.codex/config.toml` / `<repo>/.codex/hooks.json`        | TOML / JSON |
| Plugin 捆绑 | `plugin/hooks/hooks.json`（需启用 `plugin_hooks`）              | JSON        |

项目级搜索：从 git 根向下到 cwd，**距 cwd 最近的优先**。各层 hooks **全部合并并发执行**（非覆盖）。

两个关键约束（与 Claude Code 的重要差异）：

1. **信任门槛**：项目级配置必须先被「信任」才加载，未信任的 `.codex/` 目录（含 hooks/规则）被完全忽略。
2. **敏感键锁定**：项目级 config **不能覆盖** `notify`、`model_provider`、`otel`、`openai_base_url` 等，这些只在用户级生效。

官方文档：

- https://developers.openai.com/codex/config-basic
- https://developers.openai.com/codex/config-advanced

---

## 2. Hook 点清单

### 2.1 Claude Code（30+ 事件）

**能阻断 / 改写行为的：**

| 事件                                | 时机                                   | 阻断能力                                                           |
| ----------------------------------- | -------------------------------------- | ------------------------------------------------------------------ |
| `PreToolUse`                        | 工具调用前                             | 最强：`deny`/`allow`/`ask`，并可用 `updatedInput` **改写工具入参** |
| `UserPromptSubmit`                  | 用户提交 prompt、处理前                | 阻断 prompt                                                        |
| `UserPromptExpansion`               | slash 命令展开为 prompt 前             | 阻断展开                                                           |
| `PermissionRequest`                 | 权限弹窗时                             | 拒绝权限                                                           |
| `PostToolBatch`                     | 一批并行工具全部完成、下一轮模型调用前 | 停止 agentic loop                                                  |
| `Stop`                              | Claude 完成本轮回复时                  | 阻止停止，继续对话（质量门控常用）                                 |
| `SubagentStop`                      | 子 agent 完成时                        | 阻止子 agent 停止                                                  |
| `TaskCreated` / `TaskCompleted`     | 任务创建 / 标记完成时                  | 回滚创建 / 阻止完成                                                |
| `TeammateIdle`                      | teammate 将进入 idle 时                | 让其继续工作                                                       |
| `ConfigChange`                      | 会话中配置变化时                       | 阻止变更生效（policy_settings 除外）                               |
| `WorktreeCreate`                    | 创建 worktree 时                       | 非零 exit 中止创建                                                 |
| `PreCompact`                        | 上下文压缩前                           | 阻止压缩                                                           |
| `Elicitation` / `ElicitationResult` | MCP 请求用户输入 / 回复前              | 拒绝 / 阻止响应                                                    |

**只观察、不阻断（纯副作用）：**
`SessionStart`、`Setup`、`PermissionDenied`、`PostToolUse`、`PostToolUseFailure`、
`Notification`、`MessageDisplay`、`SubagentStart`、`StopFailure`、`InstructionsLoaded`、
`CwdChanged`、`FileChanged`、`WorktreeRemove`、`PostCompact`、`SessionEnd`。

官方文档：https://code.claude.com/docs/en/hooks.md

### 2.2 Codex CLI（6 个核心事件）

| 事件                | 时机                     | matcher                                                 | 阻断                                         |
| ------------------- | ------------------------ | ------------------------------------------------------- | -------------------------------------------- |
| `SessionStart`      | 启动/恢复/clear          | `source`（startup/resume/clear）                        | 可（`continue:false`）                       |
| `UserPromptSubmit`  | 提交 prompt 前           | —                                                       | 可                                           |
| `PreToolUse`        | 工具执行前               | `tool_name`（`Bash`/`apply_patch`/`mcp__server__tool`） | 可 `deny`；**不支持改写入参**（fail-closed） |
| `PermissionRequest` | 审批弹窗前（Codex 独有） | `tool_name`                                             | 可 `allow`（绕过）/`deny`                    |
| `PostToolUse`       | 工具执行后               | `tool_name`                                             | 可向模型反馈；副作用已发生无法撤销           |
| `Stop`              | 一轮 turn 结束           | —                                                       | `block` = 触发续跑，而非真停止               |

> 历史版本曾有 `turn_start`/`turn_end`/`pre_compact`/`session_end`/`subagent_*`，
> 后对齐 Claude 命名重构归并为上述 6 个。

Codex 当前实现缺口（截至调查时）：

1. `PreToolUse` **不能改 `tool_input`**，写入 `updatedInput` 会 fail-closed。
2. 文件编辑（`apply_patch`）有时走 Bash bridge，matcher 需包含 `Bash` 才能拦到。
3. 只支持 `command` 类型 handler，`prompt`/`agent` 类型已解析但被跳过。
4. `suppressOutput`、`permissionDecision:"ask"` 已解析但未实现（fail-open，慎用）。
5. Stop hook 要求 JSON 输出，纯文本无效。

---

## 3. Hook 配置结构（两边几乎一致）

三层嵌套：事件名 → matcher group（过滤） → handler 列表。

Claude Code（JSON）：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "if": "Bash(rm *)",
            "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/check.sh",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

Codex（TOML inline，等价语义）：

```toml
[[hooks.PreToolUse]]
matcher = "^Bash$"

[[hooks.PreToolUse.hooks]]
type = "command"
command = "/usr/local/bin/my-policy.sh"
timeout = 30
```

### Hook 输入 / 输出协议

- **输入**：JSON 经 stdin，含 `session_id`、`cwd`、`hook_event_name`、`model`、`tool_name`、`tool_input` 等。
- **输出**：JSON 经 stdout（精细控制，推荐），或用 exit code。
- **Claude Code exit code 语义**：
  - `exit 2` → 阻断（具体效果按事件不同）。
  - `exit 1` / 其它非零 → 非阻断错误，仅显示一行 stderr，继续执行。
  - `exit 0` + JSON → 精细控制（优于 exit code 方式）。
  - 两者不混用：exit 2 时 stdout JSON 被忽略；精细 JSON 必须配 exit 0。

`PreToolUse` 精细控制示例（Claude Code）：

```json
// 改写入参后再执行（Codex 不支持这一招）
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "updatedInput": { "command": "npm run lint -- --fix" }
  }
}
```

`Stop` 质量门控示例（Claude Code）：

```json
{ "decision": "block", "reason": "测试未通过，请修复后再提交" }
```

阻断协议（两边通用）：

```json
{
  "hookSpecificOutput": {
    "permissionDecision": "deny",
    "permissionDecisionReason": "..."
  }
}
```

---

## 4. 其它扩展机制（非 hooks 但等价 / 互补）

### Codex

| 机制                              | 位置                                           | 作用                                                  | 项目级           |
| --------------------------------- | ---------------------------------------------- | ----------------------------------------------------- | ---------------- |
| `notify`                          | `~/.codex/config.toml`（仅用户级）             | turn 完成后 fire-and-forget 通知命令，收 JSON payload | 否               |
| `AGENTS.md`                       | 全局 `~/.codex/AGENTS.md` + 各目录 `AGENTS.md` | 注入持久自定义指令                                    | 是（目录级叠加） |
| `[mcp_servers]`                   | `~/.codex/config.toml` 或 `.codex/config.toml` | 注册 MCP server 扩展工具集                            | 是               |
| `requirements.toml`（企业）       | 系统级/MDM                                     | 强制 hooks 策略，用户不可禁用                         | 系统级           |
| `/hooks` TUI 命令                 | CLI 内交互                                     | 浏览/trust/toggle 已注册 hooks                        | —                |
| `--dangerously-bypass-hook-trust` | CLI flag                                       | 跳过信任审查一次性运行                                | —                |

### 关键行为差异（对比 Claude Code）

- **自动模式下 hooks 是否执行**：
  - Codex `--full-auto`：保留 hooks 执行，只抑制审批提示。
  - Claude Code `--dangerously-skip-permissions`：**完全禁用 hooks**。
- **PreToolUse 改写入参**：Claude Code 支持（`updatedInput`），Codex 不支持。
- **私有不共享层**：Claude Code 有 `.local.json`；Codex 无对应概念（靠 trust + 用户级敏感键锁定）。

---

## 5. 对 claw 的启示（备忘，非决定）

- 若要做跨 agent 的统一钩子层，先按上面的「5 事件交集」设计最小集，再按需扩展。
- `PreToolUse` 的「改写入参」能力很强但只有 Claude Code 有——如果依赖它，要么 claw 自己实现等价层，要么对 Codex 降级为 allow/deny。
- 三层嵌套（event → matcher → handler）+ stdin JSON / stdout JSON + exit code 语义，是当前事实标准，claw 若做 hooks 建议直接对齐，降低用户迁移成本。
- 配置分层注意「个人 vs 团队共享」的区分（Claude 用文件名区分，Codex 用 trust + 敏感键锁定），claw 需要明确自己走哪条路。

---

## 附：来源 URL

Claude Code：

- Settings：https://code.claude.com/docs/en/settings.md
- Hooks：https://code.claude.com/docs/en/hooks.md

Codex（机制可信，版本/PR 待回源）：

- Hooks：https://developers.openai.com/codex/hooks
- Config basic：https://developers.openai.com/codex/config-basic
- Config advanced：https://developers.openai.com/codex/config-advanced
- AGENTS.md：https://developers.openai.com/codex/guides/agents-md
- 相关 PR：#11067（core hooks）、#18893（hooks in config.toml）、#19705（plugin hooks）
