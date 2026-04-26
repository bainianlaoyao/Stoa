# OpenCode Plugin & Extension Reference

> Source: https://opencode.ai/docs/ — Fetched April 2026

Comprehensive local reference for OpenCode plugin development, SDK usage, server APIs, agent configuration, custom tools, skills, permissions, and config schema.

---

## Table of Contents

- [1. Plugins](#1-plugins)
  - [1.1 Use a Plugin](#11-use-a-plugin)
  - [1.2 Create a Plugin](#12-create-a-plugin)
  - [1.3 Plugin Examples](#13-plugin-examples)
- [2. Plugin Events Reference](#2-plugin-events-reference)
- [3. Custom Tools](#3-custom-tools)
  - [3.1 Creating a Tool](#31-creating-a-tool)
  - [3.2 Tool Examples](#32-tool-examples)
- [4. Agent Skills](#4-agent-skills)
  - [4.1 Place Files](#41-place-files)
  - [4.2 Discovery](#42-understand-discovery)
  - [4.3 Frontmatter](#43-write-frontmatter)
  - [4.4 Name Validation](#44-validate-names)
  - [4.5 Length Rules](#45-follow-length-rules)
  - [4.6 Example](#46-use-an-example)
  - [4.7 Tool Description](#47-recognize-tool-description)
  - [4.8 Permissions](#48-configure-permissions)
  - [4.9 Override Per Agent](#49-override-per-agent)
  - [4.10 Disable Skill Tool](#410-disable-the-skill-tool)
  - [4.11 Troubleshoot](#411-troubleshoot-loading)
- [5. Agents](#5-agents)
  - [5.1 Types](#51-types)
  - [5.2 Built-in Agents](#52-built-in-agents)
  - [5.3 Usage](#53-usage)
  - [5.4 Configure](#54-configure)
  - [5.5 Options](#55-options)
  - [5.6 Create Agents](#56-create-agents)
  - [5.7 Examples](#57-examples)
- [6. Permissions](#6-permissions)
  - [6.1 Actions](#61-actions)
  - [6.2 Configuration](#62-configuration)
  - [6.3 Granular Rules (Object Syntax)](#63-granular-rules-object-syntax)
  - [6.4 Available Permissions](#64-available-permissions)
  - [6.5 Defaults](#65-defaults)
  - [6.6 What "Ask" Does](#66-what-ask-does)
  - [6.7 Agents](#67-agents)
- [7. SDK](#7-sdk)
  - [7.1 Install](#71-install)
  - [7.2 Create Client](#72-create-client)
  - [7.3 Config](#73-config)
  - [7.4 Client Only](#74-client-only)
  - [7.5 Types](#75-types)
  - [7.6 Errors](#76-errors)
  - [7.7 Structured Output](#77-structured-output)
  - [7.8 APIs](#78-apis)
- [8. Server](#8-server)
  - [8.1 Usage](#81-usage)
  - [8.2 Authentication](#82-authentication)
  - [8.3 How It Works](#83-how-it-works)
  - [8.4 Spec](#84-spec)
  - [8.5 API Endpoints](#85-api-endpoints)
- [9. Config](#9-config)
  - [9.1 Format](#91-format)
  - [9.2 Locations](#92-locations)
  - [9.3 Schema](#93-schema)
  - [9.4 Variables](#94-variables)

---

## 1. Plugins

Plugins allow you to extend OpenCode by hooking into various events and customizing behavior. You can create plugins to add new features, integrate with external services, or modify OpenCode's default behavior.

### 1.1 Use a Plugin

#### From Local Files

Place JavaScript or TypeScript files in the plugin directory:

- `.opencode/plugins/` — Project-level plugins
- `~/.config/opencode/plugins/` — Global plugins

Files in these directories are automatically loaded at startup.

#### From npm

Specify npm packages in your config file:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-helicone-session",
    "opencode-wakatime",
    "@my-org/custom-plugin"
  ]
}
```

Both regular and scoped npm packages are supported.

#### How Plugins Are Installed

- **npm plugins** are installed automatically using Bun at startup. Packages and their dependencies are cached in `~/.cache/opencode/node_modules/`.
- **Local plugins** are loaded directly from the plugin directory. To use external packages, you must create a `package.json` within your config directory (see [Dependencies](#dependencies)), or publish the plugin to npm and add it to your config.

#### Load Order

Plugins are loaded from all sources and all hooks run in sequence. The load order is:

1. Global config (`~/.config/opencode/opencode.json`)
2. Project config (`opencode.json`)
3. Global plugin directory (`~/.config/opencode/plugins/`)
4. Project plugin directory (`.opencode/plugins/`)

Duplicate npm packages with the same name and version are loaded once. However, a local plugin and an npm plugin with similar names are both loaded separately.

### 1.2 Create a Plugin

A plugin is a **JavaScript/TypeScript module** that exports one or more plugin functions. Each function receives a context object and returns a hooks object.

#### Dependencies

Local plugins and custom tools can use external npm packages. Add a `package.json` to your config directory with the dependencies you need.

`.opencode/package.json`:

```json
{
  "dependencies": {
    "shescape": "^2.1.0"
  }
}
```

OpenCode runs `bun install` at startup to install these. Your plugins and tools can then import them.

`.opencode/plugins/my-plugin.ts`:

```ts
import { escape } from "shescape"

export const MyPlugin = async (ctx) => {
  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool === "bash") {
        output.args.command = escape(output.args.command)
      }
    },
  }
}
```

#### Basic Structure

`.opencode/plugins/example.js`:

```js
export const MyPlugin = async ({ project, client, $, directory, worktree }) => {
  console.log("Plugin initialized!")

  return {
    // Hook implementations go here
  }
}
```

The plugin function receives:

| Parameter    | Description                                  |
|-------------|----------------------------------------------|
| `project`   | The current project information              |
| `directory` | The current working directory                |
| `worktree`  | The git worktree path                        |
| `client`    | An opencode SDK client for interacting with the AI |
| `$`         | Bun's [shell API](https://bun.com/docs/runtime/shell) for executing commands |

#### TypeScript Support

For TypeScript plugins, you can import types from the plugin package:

```ts
import type { Plugin } from "@opencode-ai/plugin"

export const MyPlugin: Plugin = async ({ project, client, $, directory, worktree }) => {
  return {
    // Type-safe hook implementations
  }
}
```

#### Events

Plugins can subscribe to events (see [Section 2: Plugin Events Reference](#2-plugin-events-reference) for the complete list).

### 1.3 Plugin Examples

#### Send Notifications

`.opencode/plugins/notification.js`:

```js
export const NotificationPlugin = async ({ project, client, $, directory, worktree }) => {
  return {
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        await $`osascript -e 'display notification "Session completed!" with title "opencode"'`
      }
    },
  }
}
```

#### .env Protection

`.opencode/plugins/env-protection.js`:

```js
export const EnvProtection = async ({ project, client, $, directory, worktree }) => {
  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool === "read" && output.args.filePath.includes(".env")) {
        throw new Error("Do not read .env files")
      }
    },
  }
}
```

#### Inject Environment Variables

`.opencode/plugins/inject-env.js`:

```js
export const InjectEnvPlugin = async () => {
  return {
    "shell.env": async (input, output) => {
      output.env.MY_API_KEY = "secret"
      output.env.PROJECT_ROOT = input.cwd
    },
  }
}
```

#### Custom Tools via Plugin

`.opencode/plugins/custom-tools.ts`:

```ts
import { type Plugin, tool } from "@opencode-ai/plugin"

export const CustomToolsPlugin: Plugin = async (ctx) => {
  return {
    tool: {
      mytool: tool({
        description: "This is a custom tool",
        args: {
          foo: tool.schema.string(),
        },
        async execute(args, context) {
          const { directory, worktree } = context
          return `Hello ${args.foo} from ${directory} (worktree: ${worktree})`
        },
      }),
    },
  }
}
```

The `tool` helper creates a custom tool that opencode can call. It takes a Zod schema function and returns a tool definition with:

- `description`: What the tool does
- `args`: Zod schema for the tool's arguments
- `execute`: Function that runs when the tool is called

> **Note:** If a plugin tool uses the same name as a built-in tool, the plugin tool takes precedence.

#### Logging

Use `client.app.log()` instead of `console.log` for structured logging:

`.opencode/plugins/my-plugin.ts`:

```ts
export const MyPlugin = async ({ client }) => {
  await client.app.log({
    body: {
      service: "my-plugin",
      level: "info",
      message: "Plugin initialized",
      extra: { foo: "bar" },
    },
  })
}
```

Levels: `debug`, `info`, `warn`, `error`.

#### Compaction Hooks

Customize the context included when a session is compacted:

`.opencode/plugins/compaction.ts`:

```ts
import type { Plugin } from "@opencode-ai/plugin"

export const CompactionPlugin: Plugin = async (ctx) => {
  return {
    "experimental.session.compacting": async (input, output) => {
      output.context.push(`## Custom Context

Include any state that should persist across compaction:
- Current task status
- Important decisions made
- Files being actively worked on`)
    },
  }
}
```

The `experimental.session.compacting` hook fires before the LLM generates a continuation summary. Use it to inject domain-specific context that the default compaction prompt would miss.

You can also replace the compaction prompt entirely by setting `output.prompt`:

`.opencode/plugins/custom-compaction.ts`:

```ts
import type { Plugin } from "@opencode-ai/plugin"

export const CustomCompactionPlugin: Plugin = async (ctx) => {
  return {
    "experimental.session.compacting": async (input, output) => {
      output.prompt = `You are generating a continuation prompt for a multi-agent swarm session.

Summarize:
1. The current task and its status
2. Which files are being modified and by whom
3. Any blockers or dependencies between agents
4. The next steps to complete the work

Format as a structured prompt that a new agent can use to resume work.`
    },
  }
}
```

When `output.prompt` is set, it completely replaces the default compaction prompt. The `output.context` array is ignored in this case.

---

## 2. Plugin Events Reference

### Command Events

| Event                | Description          |
|----------------------|----------------------|
| `command.executed`   | A command was executed |

### File Events

| Event                   | Description               |
|-------------------------|---------------------------|
| `file.edited`           | A file was edited         |
| `file.watcher.updated`  | File watcher detected a change |

### Installation Events

| Event                    | Description               |
|--------------------------|---------------------------|
| `installation.updated`   | Installation was updated  |

### LSP Events

| Event                      | Description                |
|----------------------------|----------------------------|
| `lsp.client.diagnostics`  | LSP diagnostics received   |
| `lsp.updated`              | LSP state updated          |

### Message Events

| Event                   | Description                |
|-------------------------|----------------------------|
| `message.part.removed`  | A message part was removed |
| `message.part.updated`  | A message part was updated |
| `message.removed`       | A message was removed      |
| `message.updated`       | A message was updated      |

### Permission Events

| Event                | Description                 |
|----------------------|-----------------------------|
| `permission.asked`   | Permission was requested    |
| `permission.replied` | Permission response received |

### Server Events

| Event                | Description          |
|----------------------|----------------------|
| `server.connected`   | Server connected     |

### Session Events

| Event                  | Description                |
|------------------------|----------------------------|
| `session.created`      | A session was created      |
| `session.compacted`    | A session was compacted    |
| `session.deleted`      | A session was deleted      |
| `session.diff`         | Session diff generated     |
| `session.error`        | Session encountered error  |
| `session.idle`         | Session became idle        |
| `session.status`       | Session status changed     |
| `session.updated`      | Session was updated        |

### Todo Events

| Event           | Description           |
|-----------------|-----------------------|
| `todo.updated`  | Todo list was updated |

### Shell Events

| Event        | Description                        |
|--------------|------------------------------------|
| `shell.env`  | Shell environment configuration    |

### Tool Events

| Event                    | Description                   |
|--------------------------|-------------------------------|
| `tool.execute.after`     | After a tool executes          |
| `tool.execute.before`    | Before a tool executes         |

### TUI Events

| Event                   | Description                |
|-------------------------|----------------------------|
| `tui.prompt.append`     | Prompt text was appended   |
| `tui.command.execute`   | TUI command was executed   |
| `tui.toast.show`        | Toast notification shown   |

---

## 3. Custom Tools

Custom tools are functions you create that the LLM can call during conversations. They work alongside opencode's built-in tools like `read`, `write`, and `bash`.

### 3.1 Creating a Tool

Tools are defined as **TypeScript** or **JavaScript** files. However, the tool definition can invoke scripts written in **any language** — TypeScript or JavaScript is only used for the tool definition itself.

#### Location

- **Local:** `.opencode/tools/` directory of your project
- **Global:** `~/.config/opencode/tools/`

#### Structure

The easiest way to create tools is using the `tool()` helper which provides type-safety and validation.

`.opencode/tools/database.ts`:

```ts
import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "Query the project database",
  args: {
    query: tool.schema.string().describe("SQL query to execute"),
  },
  async execute(args) {
    return `Executed query: ${args.query}`
  },
})
```

The **filename** becomes the **tool name**. The above creates a `database` tool.

#### Multiple Tools Per File

You can also export multiple tools from a single file. Each export becomes **a separate tool** with the name **`<filename>_<exportname>`**:

`.opencode/tools/math.ts`:

```ts
import { tool } from "@opencode-ai/plugin"

export const add = tool({
  description: "Add two numbers",
  args: {
    a: tool.schema.number().describe("First number"),
    b: tool.schema.number().describe("Second number"),
  },
  async execute(args) {
    return args.a + args.b
  },
})

export const multiply = tool({
  description: "Multiply two numbers",
  args: {
    a: tool.schema.number().describe("First number"),
    b: tool.schema.number().describe("Second number"),
  },
  async execute(args) {
    return args.a * args.b
  },
})
```

This creates two tools: `math_add` and `math_multiply`.

#### Name Collisions with Built-in Tools

Custom tools are keyed by tool name. If a custom tool uses the same name as a built-in tool, the custom tool takes precedence.

For example, this file replaces the built-in `bash` tool:

`.opencode/tools/bash.ts`:

```ts
import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "Restricted bash wrapper",
  args: {
    command: tool.schema.string(),
  },
  async execute(args) {
    return `blocked: ${args.command}`
  },
})
```

> **Note:** Prefer unique names unless you intentionally want to replace a built-in tool. If you want to disable a built-in tool but not override it, use [permissions](#6-permissions).

#### Arguments

You can use `tool.schema`, which is just [Zod](https://zod.dev), to define argument types:

```ts
args: {
  query: tool.schema.string().describe("SQL query to execute")
}
```

You can also import Zod directly and return a plain object:

```ts
import { z } from "zod"

export default {
  description: "Tool description",
  args: {
    param: z.string().describe("Parameter description"),
  },
  async execute(args, context) {
    return "result"
  },
}
```

#### Context

Tools receive context about the current session:

`.opencode/tools/project.ts`:

```ts
import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "Get project information",
  args: {},
  async execute(args, context) {
    const { agent, sessionID, messageID, directory, worktree } = context
    return `Agent: ${agent}, Session: ${sessionID}, Message: ${messageID}, Directory: ${directory}, Worktree: ${worktree}`
  },
})
```

Context properties:

| Property    | Description                     |
|------------|---------------------------------|
| `agent`    | Current agent name              |
| `sessionID`| Current session ID              |
| `messageID`| Current message ID              |
| `directory`| Session working directory       |
| `worktree` | Git worktree root               |

### 3.2 Tool Examples

#### Write a Tool in Python

You can write your tools in any language. First, create the tool as a Python script:

`.opencode/tools/add.py`:

```python
import sys

a = int(sys.argv[1])
b = int(sys.argv[2])
print(a + b)
```

Then create the tool definition that invokes it:

`.opencode/tools/python-add.ts`:

```ts
import { tool } from "@opencode-ai/plugin"
import path from "path"

export default tool({
  description: "Add two numbers using Python",
  args: {
    a: tool.schema.number().describe("First number"),
    b: tool.schema.number().describe("Second number"),
  },
  async execute(args, context) {
    const script = path.join(context.worktree, ".opencode/tools/add.py")
    const result = await Bun.$`python3 ${script} ${args.a} ${args.b}`.text()
    return result.trim()
  },
})
```

Here we are using the `Bun.$` utility to run the Python script.

---

## 4. Agent Skills

Agent skills let OpenCode discover reusable instructions from your repo or home directory. Skills are loaded on-demand via the native `skill` tool — agents see available skills and can load the full content when needed.

### 4.1 Place Files

Create one folder per skill name and put a `SKILL.md` inside it. OpenCode searches these locations:

| Scope    | Path                                              |
|----------|---------------------------------------------------|
| Project  | `.opencode/skills/<name>/SKILL.md`               |
| Global   | `~/.config/opencode/skills/<name>/SKILL.md`      |
| Claude-compatible (project) | `.claude/skills/<name>/SKILL.md`    |
| Claude-compatible (global)  | `~/.claude/skills/<name>/SKILL.md`  |
| Agent-compatible (project)  | `.agents/skills/<name>/SKILL.md`    |
| Agent-compatible (global)   | `~/.agents/skills/<name>/SKILL.md`  |

### 4.2 Understand Discovery

For project-local paths, OpenCode walks up from your current working directory until it reaches the git worktree. It loads any matching `skills/*/SKILL.md` in `.opencode/` and any matching `.claude/skills/*/SKILL.md` or `.agents/skills/*/SKILL.md` along the way.

Global definitions are also loaded from `~/.config/opencode/skills/*/SKILL.md`, `~/.claude/skills/*/SKILL.md`, and `~/.agents/skills/*/SKILL.md`.

### 4.3 Write Frontmatter

Each `SKILL.md` must start with YAML frontmatter. Only these fields are recognized:

| Field           | Required | Description                       |
|-----------------|----------|-----------------------------------|
| `name`          | Yes      | Skill name                        |
| `description`   | Yes      | Skill description (1–1024 chars)  |
| `license`       | No       | License identifier                |
| `compatibility` | No       | Compatibility info                |
| `metadata`      | No       | String-to-string map              |

Unknown frontmatter fields are ignored.

### 4.4 Validate Names

`name` must:

- Be 1–64 characters
- Be lowercase alphanumeric with single hyphen separators
- Not start or end with `-`
- Not contain consecutive `--`
- Match the directory name that contains `SKILL.md`

Equivalent regex:

```
^[a-z0-9]+(-[a-z0-9]+)*$
```

### 4.5 Follow Length Rules

`description` must be 1–1024 characters. Keep it specific enough for the agent to choose correctly.

### 4.6 Use an Example

Create `.opencode/skills/git-release/SKILL.md`:

```markdown
---
name: git-release
description: Create consistent releases and changelogs
license: MIT
compatibility: opencode
metadata:
  audience: maintainers
  workflow: github
---

## What I do

- Draft release notes from merged PRs
- Propose a version bump
- Provide a copy-pasteable `gh release create` command

## When to use me

Use this when you are preparing a tagged release.
Ask clarifying questions if the target versioning scheme is unclear.
```

### 4.7 Recognize Tool Description

OpenCode lists available skills in the `skill` tool description. Each entry includes the skill name and description:

```xml
<available_skills>
  <skill>
    <name>git-release</name>
    <description>Create consistent releases and changelogs</description>
  </skill>
</available_skills>
```

The agent loads a skill by calling the tool:

```
skill({ name: "git-release" })
```

### 4.8 Configure Permissions

Control which skills agents can access using pattern-based permissions in `opencode.json`:

```json
{
  "permission": {
    "skill": {
      "*": "allow",
      "pr-review": "allow",
      "internal-*": "deny",
      "experimental-*": "ask"
    }
  }
}
```

| Permission | Behavior                              |
|------------|---------------------------------------|
| `allow`    | Skill loads immediately               |
| `deny`     | Skill hidden from agent, access rejected |
| `ask`      | User prompted for approval before loading |

Patterns support wildcards: `internal-*` matches `internal-docs`, `internal-tools`, etc.

### 4.9 Override Per Agent

Give specific agents different permissions than the global defaults.

**For custom agents** (in agent frontmatter):

```yaml
---
permission:
  skill:
    "documents-*": "allow"
---
```

**For built-in agents** (in `opencode.json`):

```json
{
  "agent": {
    "plan": {
      "permission": {
        "skill": {
          "internal-*": "allow"
        }
      }
    }
  }
}
```

### 4.10 Disable the Skill Tool

Completely disable skills for agents that shouldn't use them.

**For custom agents**:

```yaml
---
tools:
  skill: false
---
```

**For built-in agents**:

```json
{
  "agent": {
    "plan": {
      "tools": {
        "skill": false
      }
    }
  }
}
```

When disabled, the `<available_skills>` section is omitted entirely.

### 4.11 Troubleshoot Loading

If a skill does not show up:

1. Verify `SKILL.md` is spelled in all caps
2. Check that frontmatter includes `name` and `description`
3. Ensure skill names are unique across all locations
4. Check permissions — skills with `deny` are hidden from agents

---

## 5. Agents

Agents are specialized AI assistants that can be configured for specific tasks and workflows. They allow you to create focused tools with custom prompts, models, and tool access.

### 5.1 Types

There are two types of agents in OpenCode: primary agents and subagents.

#### Primary Agents

Primary agents are the main assistants you interact with directly. You can cycle through them using the **Tab** key, or your configured `switch_agent` keybind. These agents handle your main conversation. Tool access is configured via permissions — for example, Build has all tools enabled while Plan is restricted.

OpenCode comes with two built-in primary agents: **Build** and **Plan**.

#### Subagents

Subagents are specialized assistants that primary agents can invoke for specific tasks. You can also manually invoke them by **@ mentioning** them in your messages.

OpenCode comes with two built-in subagents: **General** and **Explore**.

### 5.2 Built-in Agents

| Agent         | Mode       | Description                                                                                         |
|---------------|------------|-----------------------------------------------------------------------------------------------------|
| **build**     | `primary`  | Default primary agent with all tools enabled. Standard agent for development work.                  |
| **plan**      | `primary`  | Restricted agent for planning and analysis. `file edits` and `bash` default to `ask`.               |
| **general**   | `subagent` | General-purpose agent for researching complex questions and executing multi-step tasks. Has full tool access (except todo). |
| **explore**   | `subagent` | Fast, read-only agent for exploring codebases. Cannot modify files.                                 |
| **compaction**| `primary`  | Hidden system agent that compacts long context into a smaller summary. Runs automatically.          |
| **title**     | `primary`  | Hidden system agent that generates short session titles. Runs automatically.                        |
| **summary**   | `primary`  | Hidden system agent that creates session summaries. Runs automatically.                             |

### 5.3 Usage

1. For primary agents, use the **Tab** key to cycle through them during a session. You can also use your configured `switch_agent` keybind.

2. Subagents can be invoked:
   - **Automatically** by primary agents for specialized tasks based on their descriptions.
   - **Manually** by **@ mentioning** a subagent in your message:
     ```
     @general help me search for this function
     ```

3. **Navigation between sessions**: When subagents create child sessions, use `session_child_first` (default: **<Leader>+Down**) to enter the first child session from the parent.

4. Once you are in a child session, use:
   - `session_child_cycle` (default: **Right**) to cycle to the next child session
   - `session_child_cycle_reverse` (default: **Left**) to cycle to the previous child session
   - `session_parent` (default: **Up**) to return to the parent session

### 5.4 Configure

Agents can be configured in two ways:

#### JSON Configuration

`opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "agent": {
    "build": {
      "mode": "primary",
      "model": "anthropic/claude-sonnet-4-20250514",
      "prompt": "{file:./prompts/build.txt}",
      "tools": {
        "write": true,
        "edit": true,
        "bash": true
      }
    },
    "plan": {
      "mode": "primary",
      "model": "anthropic/claude-haiku-4-20250514",
      "tools": {
        "write": false,
        "edit": false,
        "bash": false
      }
    },
    "code-reviewer": {
      "description": "Reviews code for best practices and potential issues",
      "mode": "subagent",
      "model": "anthropic/claude-sonnet-4-20250514",
      "prompt": "You are a code reviewer. Focus on security, performance, and maintainability.",
      "tools": {
        "write": false,
        "edit": false
      }
    }
  }
}
```

#### Markdown Configuration

Place markdown files in:

- **Global:** `~/.config/opencode/agents/`
- **Per-project:** `.opencode/agents/`

`~/.config/opencode/agents/review.md`:

```markdown
---
description: Reviews code for quality and best practices
mode: subagent
model: anthropic/claude-sonnet-4-20250514
temperature: 0.1
tools:
  write: false
  edit: false
  bash: false
---

You are in code review mode. Focus on:
- Code quality and best practices
- Potential bugs and edge cases
- Performance implications
- Security considerations

Provide constructive feedback without making direct changes.
```

The markdown file name becomes the agent name. For example, `review.md` creates a `review` agent.

### 5.5 Options

#### Description

Provide a brief description of what the agent does and when to use it. **Required.**

```json
{
  "agent": {
    "review": {
      "description": "Reviews code for best practices and potential issues"
    }
  }
}
```

#### Temperature

Control the randomness and creativity of the LLM's responses. Lower values = more focused, higher = more creative. Range: 0.0–1.0.

```json
{
  "agent": {
    "plan": { "temperature": 0.1 },
    "creative": { "temperature": 0.8 }
  }
}
```

| Range     | Character                                         |
|-----------|---------------------------------------------------|
| 0.0–0.2   | Very focused and deterministic, ideal for analysis and planning |
| 0.3–0.5   | Balanced, good for general development tasks       |
| 0.6–1.0   | More creative, useful for brainstorming            |

If no temperature is specified, OpenCode uses model-specific defaults; typically 0 for most models, 0.55 for Qwen models.

#### Max Steps

Control the maximum number of agentic iterations before being forced to respond with text only.

```json
{
  "agent": {
    "quick-thinker": {
      "description": "Fast reasoning with limited iterations",
      "prompt": "You are a quick thinker. Solve problems with minimal steps.",
      "steps": 5
    }
  }
}
```

When the limit is reached, the agent receives a special system prompt instructing it to respond with a summarization of its work and recommended remaining tasks.

> **Caution:** The legacy `maxSteps` field is deprecated. Use `steps` instead.

#### Disable

Set to `true` to disable the agent.

```json
{
  "agent": {
    "review": { "disable": true }
  }
}
```

#### Prompt

Specify a custom system prompt file for this agent. The path is relative to where the config file is located.

```json
{
  "agent": {
    "review": {
      "prompt": "{file:./prompts/code-review.txt}"
    }
  }
}
```

#### Model

Override the model for this agent. Format: `provider/model-id`.

```json
{
  "agent": {
    "plan": {
      "model": "anthropic/claude-haiku-4-20250514"
    }
  }
}
```

If you don't specify a model, primary agents use the globally configured model while subagents will use the model of the primary agent that invoked them.

#### Tools (Deprecated)

`tools` is **deprecated**. Prefer the agent's `permission` field for new configs.

Allows you to control which tools are available. `true` = `{"*": "allow"}`, `false` = `{"*": "deny"}`.

```json
{
  "tools": {
    "write": true,
    "bash": true
  },
  "agent": {
    "plan": {
      "tools": {
        "write": false,
        "bash": false
      }
    }
  }
}
```

Agent-specific config overrides the global config. You can also use wildcards to control multiple tools:

```json
{
  "agent": {
    "readonly": {
      "tools": {
        "mymcp_*": false,
        "write": false,
        "edit": false
      }
    }
  }
}
```

#### Permissions

Configure what actions an agent can take. Currently, the permissions for `edit`, `bash`, and `webfetch` can be configured to `"ask"`, `"allow"`, or `"deny"`.

```json
{
  "permission": { "edit": "deny" },
  "agent": {
    "build": {
      "permission": { "edit": "ask" }
    }
  }
}
```

In Markdown agents:

```yaml
---
permission:
  edit: deny
  bash:
    "*": ask
    "git diff": allow
    "git log*": allow
    "grep *": allow
  webfetch: deny
---
```

For specific bash commands:

```json
{
  "agent": {
    "build": {
      "permission": {
        "bash": {
          "git push": "ask",
          "grep *": "allow"
        }
      }
    }
  }
}
```

Glob patterns work too:

```json
{
  "agent": {
    "build": {
      "permission": {
        "bash": {
          "*": "ask",
          "git status *": "allow"
        }
      }
    }
  }
}
```

#### Mode

Control how the agent can be used. Values: `primary`, `subagent`, or `all` (default).

```json
{
  "agent": {
    "review": { "mode": "subagent" }
  }
}
```

#### Hidden

Hide a subagent from the `@` autocomplete menu with `hidden: true`. Only applies to `mode: subagent` agents. Hidden agents can still be invoked by the model via the Task tool if permissions allow.

```json
{
  "agent": {
    "internal-helper": {
      "mode": "subagent",
      "hidden": true
    }
  }
}
```

#### Task Permissions

Control which subagents an agent can invoke via the Task tool. Uses glob patterns.

```json
{
  "agent": {
    "orchestrator": {
      "mode": "primary",
      "permission": {
        "task": {
          "*": "deny",
          "orchestrator-*": "allow",
          "code-reviewer": "ask"
        }
      }
    }
  }
}
```

Rules are evaluated in order, and the **last matching rule wins**. Users can always invoke any subagent directly via the `@` autocomplete menu, even if task permissions would deny it.

#### Color

Customize the agent's visual appearance in the UI. Use a valid hex color (e.g., `#FF5733`) or theme color: `primary`, `secondary`, `accent`, `success`, `warning`, `error`, `info`.

```json
{
  "agent": {
    "creative": { "color": "#ff6b6b" },
    "code-reviewer": { "color": "accent" }
  }
}
```

#### Top P

Control response diversity. Alternative to temperature. Values: 0.0–1.0.

```json
{
  "agent": {
    "brainstorm": { "top_p": 0.9 }
  }
}
```

#### Additional

Any other options you specify in your agent configuration will be **passed through directly** to the provider as model options.

```json
{
  "agent": {
    "deep-thinker": {
      "description": "Agent that uses high reasoning effort for complex problems",
      "model": "openai/gpt-5",
      "reasoningEffort": "high",
      "textVerbosity": "low"
    }
  }
}
```

Run `opencode models` to see available models.

### 5.6 Create Agents

Create new agents using the interactive command:

```bash
opencode agent create
```

This command will:

1. Ask where to save the agent; global or project-specific.
2. Description of what the agent should do.
3. Generate an appropriate system prompt and identifier.
4. Let you select which tools the agent can access.
5. Create a markdown file with the agent configuration.

### 5.7 Examples

#### Documentation Agent

`~/.config/opencode/agents/docs-writer.md`:

```markdown
---
description: Writes and maintains project documentation
mode: subagent
tools:
  bash: false
---

You are a technical writer. Create clear, comprehensive documentation.

Focus on:
- Clear explanations
- Proper structure
- Code examples
- User-friendly language
```

#### Security Auditor

`~/.config/opencode/agents/security-auditor.md`:

```markdown
---
description: Performs security audits and identifies vulnerabilities
mode: subagent
tools:
  write: false
  edit: false
---

You are a security expert. Focus on identifying potential security issues.

Look for:
- Input validation vulnerabilities
- Authentication and authorization flaws
- Data exposure risks
- Dependency vulnerabilities
- Configuration security issues
```

---

## 6. Permissions

OpenCode uses the `permission` config to decide whether a given action should run automatically, prompt you, or be blocked.

As of `v1.1.1`, the legacy `tools` boolean config is deprecated and has been merged into `permission`. The old `tools` config is still supported for backwards compatibility.

### 6.1 Actions

Each permission rule resolves to one of:

| Action   | Description              |
|----------|--------------------------|
| `allow`  | Run without approval     |
| `ask`    | Prompt for approval      |
| `deny`   | Block the action         |

### 6.2 Configuration

Set permissions globally (with `*`), and override specific tools:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "*": "ask",
    "bash": "allow",
    "edit": "deny"
  }
}
```

Set all permissions at once:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": "allow"
}
```

### 6.3 Granular Rules (Object Syntax)

For most permissions, use an object to apply different actions based on tool input:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "bash": {
      "*": "ask",
      "git *": "allow",
      "npm *": "allow",
      "rm *": "deny",
      "grep *": "allow"
    },
    "edit": {
      "*": "deny",
      "packages/web/src/content/docs/*.mdx": "allow"
    }
  }
}
```

Rules are evaluated by pattern match, with the **last matching rule winning**. A common pattern is to put the catch-all `"*"` rule first, and more specific rules after it.

#### Wildcards

Permission patterns use simple wildcard matching:

- `*` matches zero or more of any character
- `?` matches exactly one character
- All other characters match literally

#### Home Directory Expansion

Use `~` or `$HOME` at the start of a pattern to reference your home directory:

- `~/projects/*` → `/Users/username/projects/*`
- `$HOME/projects/*` → `/Users/username/projects/*`
- `~` → `/Users/username`

#### External Directories

Use `external_directory` to allow tool calls that touch paths outside the working directory where OpenCode was started. This applies to any tool that takes a path as input (for example `read`, `edit`, `glob`, `grep`, and many `bash` commands).

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "external_directory": {
      "~/projects/personal/**": "allow"
    }
  }
}
```

Any directory allowed here inherits the same defaults as the current workspace. Since `read` defaults to `allow`, reads are also allowed for entries under `external_directory` unless overridden. Add explicit rules to restrict tools in these paths:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "external_directory": {
      "~/projects/personal/**": "allow"
    },
    "edit": {
      "~/projects/personal/**": "deny"
    }
  }
}
```

### 6.4 Available Permissions

OpenCode permissions are keyed by tool name, plus a couple of safety guards:

| Permission            | Description                                                | Matches                     |
|-----------------------|------------------------------------------------------------|-----------------------------|
| `read`                | Reading a file                                             | File path                   |
| `edit`                | All file modifications (covers `edit`, `write`, `patch`)   | File path                   |
| `glob`                | File globbing                                              | Glob pattern                |
| `grep`                | Content search                                             | Regex pattern               |
| `bash`                | Running shell commands                                     | Parsed commands             |
| `task`                | Launching subagents                                        | Subagent type               |
| `skill`               | Loading a skill                                            | Skill name                  |
| `lsp`                 | Running LSP queries                                        | (non-granular)              |
| `question`            | Asking the user questions during execution                 | —                           |
| `webfetch`            | Fetching a URL                                             | URL                         |
| `websearch`           | Web search                                                 | Query                       |
| `codesearch`          | Code search                                                | Query                       |
| `external_directory`  | Tool touches paths outside project working directory       | Path                        |
| `doom_loop`           | Same tool call repeats 3 times with identical input        | —                           |

### 6.5 Defaults

If you don't specify anything, OpenCode starts from permissive defaults:

- Most permissions default to `"allow"`.
- `doom_loop` and `external_directory` default to `"ask"`.
- `read` is `"allow"`, but `.env` files are denied by default:

```json
{
  "permission": {
    "read": {
      "*": "allow",
      "*.env": "deny",
      "*.env.*": "deny",
      "*.env.example": "allow"
    }
  }
}
```

### 6.6 What "Ask" Does

When OpenCode prompts for approval, the UI offers three outcomes:

| Outcome   | Description                                                        |
|-----------|--------------------------------------------------------------------|
| `once`    | Approve just this request                                          |
| `always`  | Approve future requests matching the suggested patterns (for the rest of the current OpenCode session) |
| `reject`  | Deny the request                                                   |

The set of patterns that `always` would approve is provided by the tool (for example, bash approvals typically whitelist a safe command prefix like `git status*`).

### 6.7 Agents

You can override permissions per agent. Agent permissions are merged with the global config, and agent rules take precedence.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "bash": {
      "*": "ask",
      "git *": "allow",
      "git commit *": "deny",
      "git push *": "deny",
      "grep *": "allow"
    }
  },
  "agent": {
    "build": {
      "permission": {
        "bash": {
          "*": "ask",
          "git *": "allow",
          "git commit *": "ask",
          "git push *": "deny",
          "grep *": "allow"
        }
      }
    }
  }
}
```

In Markdown:

`~/.config/opencode/agents/review.md`:

```markdown
---
description: Code review without edits
mode: subagent
permission:
  edit: deny
  bash: ask
  webfetch: deny
---

Only analyze code and suggest changes.
```

> **Tip:** Use pattern matching for commands with arguments. `"grep *"` allows `grep pattern file.txt`, while `"grep"` alone would block it.

---

## 7. SDK

The OpenCode JS/TS SDK provides a type-safe client for interacting with the server. Use it to build integrations and control OpenCode programmatically.

### 7.1 Install

```bash
npm install @opencode-ai/sdk
```

### 7.2 Create Client

```ts
import { createOpencode } from "@opencode-ai/sdk"

const { client } = await createOpencode()
```

This starts both a server and a client.

#### Options

| Option      | Type           | Description                  | Default     |
|-------------|----------------|------------------------------|-------------|
| `hostname`  | `string`       | Server hostname              | `127.0.0.1` |
| `port`      | `number`       | Server port                  | `4096`      |
| `signal`    | `AbortSignal`  | Abort signal for cancellation| `undefined` |
| `timeout`   | `number`       | Timeout in ms for server start | `5000`    |
| `config`    | `Config`       | Configuration object         | `{}`        |

#### With Config

```ts
import { createOpencode } from "@opencode-ai/sdk"

const opencode = await createOpencode({
  hostname: "127.0.0.1",
  port: 4096,
  config: {
    model: "anthropic/claude-3-5-sonnet-20241022",
  },
})

console.log(`Server running at ${opencode.server.url}`)
opencode.server.close()
```

### 7.3 Config

You can pass a configuration object to customize behavior. The instance still picks up your `opencode.json`, but you can override or add configuration inline.

### 7.4 Client Only

If you already have a running instance of opencode, you can create a client instance to connect to it:

```ts
import { createOpencodeClient } from "@opencode-ai/sdk"

const client = createOpencodeClient({
  baseUrl: "http://localhost:4096",
})
```

#### Client Options

| Option           | Type       | Description                       | Default              |
|------------------|------------|-----------------------------------|----------------------|
| `baseUrl`        | `string`   | URL of the server                 | `http://localhost:4096` |
| `fetch`          | `function` | Custom fetch implementation       | `globalThis.fetch`   |
| `parseAs`        | `string`   | Response parsing method           | `auto`               |
| `responseStyle`  | `string`   | Return style: `data` or `fields`  | `fields`             |
| `throwOnError`   | `boolean`  | Throw errors instead of return    | `false`              |

### 7.5 Types

The SDK includes TypeScript definitions for all API types. Import them directly:

```ts
import type { Session, Message, Part } from "@opencode-ai/sdk"
```

All types are generated from the server's OpenAPI specification and available in the [types file](https://github.com/anomalyco/opencode/blob/dev/packages/sdk/js/src/gen/types.gen.ts).

### 7.6 Errors

```ts
try {
  await client.session.get({ path: { id: "invalid-id" } })
} catch (error) {
  console.error("Failed to get session:", (error as Error).message)
}
```

### 7.7 Structured Output

You can request structured JSON output from the model by specifying a `format` with a JSON schema. The model will use a `StructuredOutput` tool to return validated JSON matching your schema.

#### Basic Usage

```ts
const result = await client.session.prompt({
  path: { id: sessionId },
  body: {
    parts: [{ type: "text", text: "Research Anthropic and provide company info" }],
    format: {
      type: "json_schema",
      schema: {
        type: "object",
        properties: {
          company: { type: "string", description: "Company name" },
          founded: { type: "number", description: "Year founded" },
          products: {
            type: "array",
            items: { type: "string" },
            description: "Main products",
          },
        },
        required: ["company", "founded"],
      },
    },
  },
})

console.log(result.data.info.structured_output)
// { company: "Anthropic", founded: 2021, products: ["Claude", "Claude API"] }
```

#### Output Format Types

| Type            | Description                                         |
|-----------------|-----------------------------------------------------|
| `text`          | Default. Standard text response (no structured output) |
| `json_schema`   | Returns validated JSON matching the provided schema |

#### JSON Schema Format

When using `type: 'json_schema'`, provide:

| Field         | Type       | Description                          |
|---------------|------------|--------------------------------------|
| `type`        | `'json_schema'` | Required. Specifies JSON schema mode |
| `schema`      | `object`   | Required. JSON Schema object defining the output structure |
| `retryCount`  | `number`   | Optional. Number of validation retries (default: 2) |

#### Error Handling

```ts
if (result.data.info.error?.name === "StructuredOutputError") {
  console.error("Failed to produce structured output:", result.data.info.error.message)
  console.error("Attempts:", result.data.info.error.retries)
}
```

#### Best Practices

1. **Provide clear descriptions** in your schema properties to help the model understand what data to extract
2. **Use `required`** to specify which fields must be present
3. **Keep schemas focused** — complex nested schemas may be harder for the model to fill correctly
4. **Set appropriate `retryCount`** — increase for complex schemas, decrease for simple ones

### 7.8 APIs

The SDK exposes all server APIs through a type-safe client.

#### Global

| Method              | Description                        | Response                                  |
|---------------------|------------------------------------|-------------------------------------------|
| `global.health()`   | Check server health and version    | `{ healthy: true, version: string }`      |

```ts
const health = await client.global.health()
console.log(health.data.version)
```

#### App

| Method          | Description           | Response   |
|-----------------|-----------------------|------------|
| `app.log()`     | Write a log entry     | `boolean`  |
| `app.agents()`  | List all available agents | `Agent[]` |

```ts
await client.app.log({
  body: {
    service: "my-app",
    level: "info",
    message: "Operation completed",
  },
})

const agents = await client.app.agents()
```

#### Project

| Method              | Description         | Response     |
|---------------------|---------------------|--------------|
| `project.list()`    | List all projects   | `Project[]`  |
| `project.current()` | Get current project | `Project`    |

```ts
const projects = await client.project.list()
const currentProject = await client.project.current()
```

#### Path

| Method        | Description        | Response |
|---------------|--------------------|----------|
| `path.get()`  | Get current path   | `Path`   |

```ts
const pathInfo = await client.path.get()
```

#### Config

| Method                | Description                         | Response          |
|-----------------------|-------------------------------------|-------------------|
| `config.get()`        | Get config info                     | `Config`          |
| `config.providers()`  | List providers and default models   | `{ providers: Provider[], default: { [key: string]: string } }` |

```ts
const config = await client.config.get()
const { providers, default: defaults } = await client.config.providers()
```

#### Sessions

| Method                                              | Description                    | Notes |
|-----------------------------------------------------|--------------------------------|-------|
| `session.list()`                                    | List sessions                  | Returns `Session[]` |
| `session.get({ path })`                             | Get session                    | Returns `Session` |
| `session.children({ path })`                        | List child sessions            | Returns `Session[]` |
| `session.create({ body })`                          | Create session                 | Returns `Session` |
| `session.delete({ path })`                          | Delete session                 | Returns `boolean` |
| `session.update({ path, body })`                    | Update session properties      | Returns `Session` |
| `session.init({ path, body })`                      | Analyze app and create `AGENTS.md` | Returns `boolean` |
| `session.abort({ path })`                           | Abort a running session        | Returns `boolean` |
| `session.share({ path })`                           | Share session                  | Returns `Session` |
| `session.unshare({ path })`                         | Unshare session                | Returns `Session` |
| `session.summarize({ path, body })`                 | Summarize session              | Returns `boolean` |
| `session.messages({ path })`                        | List messages in a session     | Returns `{ info: Message, parts: Part[] }[]` |
| `session.message({ path })`                         | Get message details            | Returns `{ info: Message, parts: Part[] }` |
| `session.prompt({ path, body })`                    | Send prompt message            | `body.noReply: true` returns UserMessage (context only). Default returns `AssistantMessage` with AI response. Supports `body.outputFormat` for structured output |
| `session.command({ path, body })`                   | Send command to session        | Returns `{ info: AssistantMessage, parts: Part[] }` |
| `session.shell({ path, body })`                     | Run a shell command            | Returns `AssistantMessage` |
| `session.revert({ path, body })`                    | Revert a message               | Returns `Session` |
| `session.unrevert({ path })`                        | Restore reverted messages      | Returns `Session` |
| `postSessionByIdPermissionsByPermissionId({ path, body })` | Respond to a permission request | Returns `boolean` |

```ts
// Create and manage sessions
const session = await client.session.create({
  body: { title: "My session" },
})

const sessions = await client.session.list()

// Send a prompt message
const result = await client.session.prompt({
  path: { id: session.id },
  body: {
    model: { providerID: "anthropic", modelID: "claude-3-5-sonnet-20241022" },
    parts: [{ type: "text", text: "Hello!" }],
  },
})

// Inject context without triggering AI response (useful for plugins)
await client.session.prompt({
  path: { id: session.id },
  body: {
    noReply: true,
    parts: [{ type: "text", text: "You are a helpful assistant." }],
  },
})
```

#### Files

| Method                        | Description                     | Response                                      |
|-------------------------------|---------------------------------|-----------------------------------------------|
| `find.text({ query })`        | Search for text in files        | Array of match objects with `path`, `lines`, `line_number`, `absolute_offset`, `submatches` |
| `find.files({ query })`       | Find files and directories by name | `string[]` (paths)                         |
| `find.symbols({ query })`     | Find workspace symbols          | `Symbol[]`                                    |
| `file.read({ query })`        | Read a file                     | `{ type: "raw" \| "patch", content: string }` |
| `file.status({ query? })`     | Get status for tracked files    | `File[]`                                      |

`find.files` supports optional query fields:

- `type`: `"file"` or `"directory"`
- `directory`: override the project root for the search
- `limit`: max results (1–200)

```ts
const textResults = await client.find.text({
  query: { pattern: "function.*opencode" },
})

const files = await client.find.files({
  query: { query: "*.ts", type: "file" },
})

const directories = await client.find.files({
  query: { query: "packages", type: "directory", limit: 20 },
})

const content = await client.file.read({
  query: { path: "src/index.ts" },
})
```

#### TUI

| Method                            | Description           | Response  |
|-----------------------------------|-----------------------|-----------|
| `tui.appendPrompt({ body })`      | Append text to the prompt | `boolean` |
| `tui.openHelp()`                  | Open the help dialog  | `boolean` |
| `tui.openSessions()`              | Open the session selector | `boolean` |
| `tui.openThemes()`                | Open the theme selector | `boolean` |
| `tui.openModels()`                | Open the model selector | `boolean` |
| `tui.submitPrompt()`              | Submit the current prompt | `boolean` |
| `tui.clearPrompt()`               | Clear the prompt      | `boolean` |
| `tui.executeCommand({ body })`    | Execute a command     | `boolean` |
| `tui.showToast({ body })`         | Show toast notification | `boolean` |

```ts
await client.tui.appendPrompt({
  body: { text: "Add this to prompt" },
})

await client.tui.showToast({
  body: { message: "Task completed", variant: "success" },
})
```

#### Auth

| Method                    | Description              | Response  |
|---------------------------|--------------------------|-----------|
| `auth.set({ ... })`       | Set authentication credentials | `boolean` |

```ts
await client.auth.set({
  path: { id: "anthropic" },
  body: { type: "api", key: "your-api-key" },
})
```

#### Events

| Method                  | Description               | Response                  |
|-------------------------|---------------------------|---------------------------|
| `event.subscribe()`     | Server-sent events stream | Server-sent events stream |

```ts
const events = await client.event.subscribe()
for await (const event of events.stream) {
  console.log("Event:", event.type, event.properties)
}
```

---

## 8. Server

The `opencode serve` command runs a headless HTTP server that exposes an OpenAPI endpoint that an opencode client can use.

### 8.1 Usage

```bash
opencode serve [--port <number>] [--hostname <string>] [--cors <origin>]
```

| Flag              | Description                      | Default          |
|-------------------|----------------------------------|------------------|
| `--port`          | Port to listen on                | `4096`           |
| `--hostname`      | Hostname to listen on            | `127.0.0.1`      |
| `--mdns`          | Enable mDNS discovery            | `false`          |
| `--mdns-domain`   | Custom domain name for mDNS      | `opencode.local` |
| `--cors`          | Additional browser origins to allow | `[]`          |

`--cors` can be passed multiple times:

```bash
opencode serve --cors http://localhost:5173 --cors https://app.example.com
```

### 8.2 Authentication

Set `OPENCODE_SERVER_PASSWORD` to protect the server with HTTP basic auth. The username defaults to `opencode`, or set `OPENCODE_SERVER_USERNAME` to override it.

```bash
OPENCODE_SERVER_PASSWORD=your-password opencode serve
```

### 8.3 How It Works

When you run `opencode` it starts a TUI and a server. The TUI is the client that talks to the server. The server exposes an OpenAPI 3.1 spec endpoint. This endpoint is also used to generate an SDK.

You can run `opencode serve` to start a standalone server. If you have the opencode TUI running, `opencode serve` will start a new server.

#### Connect to an Existing Server

When you start the TUI it randomly assigns a port and hostname. You can instead pass in the `--hostname` and `--port` flags. Then use this to connect to its server.

The `/tui` endpoint can be used to drive the TUI through the server. For example, you can prefill or run a prompt. This setup is used by the OpenCode IDE plugins.

### 8.4 Spec

The server publishes an OpenAPI 3.1 spec that can be viewed at:

```
http://<hostname>:<port>/doc
```

For example, `http://localhost:4096/doc`.

### 8.5 API Endpoints

#### Global

| Method | Path              | Description                       | Response                              |
|--------|-------------------|-----------------------------------|---------------------------------------|
| `GET`  | `/global/health`  | Get server health and version     | `{ healthy: true, version: string }`  |
| `GET`  | `/global/event`   | Get global events (SSE stream)    | Event stream                          |

#### Project

| Method | Path               | Description           | Response     |
|--------|--------------------|-----------------------|--------------|
| `GET`  | `/project`         | List all projects     | `Project[]`  |
| `GET`  | `/project/current` | Get the current project | `Project`  |

#### Path & VCS

| Method | Path    | Description                      | Response   |
|--------|---------|----------------------------------|------------|
| `GET`  | `/path` | Get the current path             | `Path`     |
| `GET`  | `/vcs`  | Get VCS info for the current project | `VcsInfo` |

#### Instance

| Method  | Path                 | Description               | Response  |
|---------|----------------------|---------------------------|-----------|
| `POST`  | `/instance/dispose`  | Dispose the current instance | `boolean` |

#### Config

| Method  | Path                 | Description              | Response          |
|---------|----------------------|--------------------------|-------------------|
| `GET`   | `/config`            | Get config info          | `Config`          |
| `PATCH` | `/config`            | Update config            | `Config`          |
| `GET`   | `/config/providers`  | List providers and default models | `{ providers: Provider[], default: { [key: string]: string } }` |

#### Provider

| Method  | Path                            | Description                         | Response                   |
|---------|---------------------------------|-------------------------------------|----------------------------|
| `GET`   | `/provider`                     | List all providers                  | `{ all: Provider[], default: {...}, connected: string[] }` |
| `GET`   | `/provider/auth`                | Get provider authentication methods | `{ [providerID: string]: ProviderAuthMethod[] }` |
| `POST`  | `/provider/{id}/oauth/authorize`| Authorize a provider using OAuth    | `ProviderAuthAuthorization` |
| `POST`  | `/provider/{id}/oauth/callback` | Handle OAuth callback for a provider | `boolean` |

#### Sessions

| Method    | Path                                     | Description                       | Notes |
|-----------|------------------------------------------|-----------------------------------|-------|
| `GET`     | `/session`                               | List all sessions                 | Returns `Session[]` |
| `POST`    | `/session`                               | Create a new session              | body: `{ parentID?, title? }`, returns `Session` |
| `GET`     | `/session/status`                        | Get session status for all sessions | Returns `{ [sessionID: string]: SessionStatus }` |
| `GET`     | `/session/:id`                           | Get session details               | Returns `Session` |
| `DELETE`  | `/session/:id`                           | Delete a session and all its data | Returns `boolean` |
| `PATCH`   | `/session/:id`                           | Update session properties         | body: `{ title? }`, returns `Session` |
| `GET`     | `/session/:id/children`                  | Get a session's child sessions    | Returns `Session[]` |
| `GET`     | `/session/:id/todo`                      | Get the todo list for a session   | Returns `Todo[]` |
| `POST`    | `/session/:id/init`                      | Analyze app and create `AGENTS.md`| body: `{ messageID, providerID, modelID }`, returns `boolean` |
| `POST`    | `/session/:id/fork`                      | Fork an existing session at a message | body: `{ messageID? }`, returns `Session` |
| `POST`    | `/session/:id/abort`                     | Abort a running session           | Returns `boolean` |
| `POST`    | `/session/:id/share`                     | Share a session                   | Returns `Session` |
| `DELETE`  | `/session/:id/share`                     | Unshare a session                 | Returns `Session` |
| `GET`     | `/session/:id/diff`                      | Get the diff for this session     | query: `messageID?`, returns `FileDiff[]` |
| `POST`    | `/session/:id/summarize`                 | Summarize the session             | body: `{ providerID, modelID }`, returns `boolean` |
| `POST`    | `/session/:id/revert`                    | Revert a message                  | body: `{ messageID, partID? }`, returns `boolean` |
| `POST`    | `/session/:id/unrevert`                  | Restore all reverted messages     | Returns `boolean` |
| `POST`    | `/session/:id/permissions/:permissionID` | Respond to a permission request   | body: `{ response, remember? }`, returns `boolean` |

#### Messages

| Method  | Path                           | Description                       | Notes |
|---------|--------------------------------|-----------------------------------|-------|
| `GET`   | `/session/:id/message`         | List messages in a session        | query: `limit?`, returns `{ info: Message, parts: Part[] }[]` |
| `POST`  | `/session/:id/message`         | Send a message and wait for response | body: `{ messageID?, model?, agent?, noReply?, system?, tools?, parts }`, returns `{ info: Message, parts: Part[] }` |
| `GET`   | `/session/:id/message/:messageID` | Get message details            | Returns `{ info: Message, parts: Part[] }` |
| `POST`  | `/session/:id/prompt_async`    | Send a message asynchronously (no wait) | body: same as `/session/:id/message`, returns `204 No Content` |
| `POST`  | `/session/:id/command`         | Execute a slash command           | body: `{ messageID?, agent?, model?, command, arguments }`, returns `{ info: Message, parts: Part[] }` |
| `POST`  | `/session/:id/shell`           | Run a shell command               | body: `{ agent, model?, command }`, returns `{ info: Message, parts: Part[] }` |

#### Commands

| Method | Path        | Description        | Response     |
|--------|-------------|--------------------|--------------|
| `GET`  | `/command`  | List all commands  | `Command[]`  |

#### Files

| Method | Path                              | Description                     | Response                                      |
|--------|-----------------------------------|---------------------------------|-----------------------------------------------|
| `GET`  | `/find?pattern=<pat>`             | Search for text in files        | Array of match objects with `path`, `lines`, `line_number`, `absolute_offset`, `submatches` |
| `GET`  | `/find/file?query=<q>`            | Find files and directories by name | `string[]` (paths)                         |
| `GET`  | `/find/symbol?query=<q>`          | Find workspace symbols          | `Symbol[]`                                    |
| `GET`  | `/file?path=<path>`               | List files and directories      | `FileNode[]`                                  |
| `GET`  | `/file/content?path=<p>`          | Read a file                     | `FileContent`                                 |
| `GET`  | `/file/status`                    | Get status for tracked files    | `File[]`                                      |

`/find/file` query parameters:

- `query` (required) — search string (fuzzy match)
- `type` (optional) — limit results to `"file"` or `"directory"`
- `directory` (optional) — override the project root for the search
- `limit` (optional) — max results (1–200)
- `dirs` (optional) — legacy flag (`"false"` returns only files)

#### Tools (Experimental)

| Method | Path                                         | Description                          | Response     |
|--------|----------------------------------------------|--------------------------------------|--------------|
| `GET`  | `/experimental/tool/ids`                     | List all tool IDs                    | `ToolIDs`    |
| `GET`  | `/experimental/tool?provider=<p>&model=<m>`  | List tools with JSON schemas for a model | `ToolList` |

#### LSP, Formatters & MCP

| Method | Path          | Description              | Response                                  |
|--------|---------------|--------------------------|-------------------------------------------|
| `GET`  | `/lsp`        | Get LSP server status    | `LSPStatus[]`                             |
| `GET`  | `/formatter`  | Get formatter status     | `FormatterStatus[]`                       |
| `GET`  | `/mcp`        | Get MCP server status    | `{ [name: string]: MCPStatus }`           |
| `POST` | `/mcp`        | Add MCP server dynamically | body: `{ name, config }`, returns MCP status object |

#### Agents

| Method | Path      | Description             | Response   |
|--------|-----------|-------------------------|------------|
| `GET`  | `/agent`  | List all available agents | `Agent[]` |

#### Logging

| Method  | Path    | Description                                         | Response  |
|---------|---------|-----------------------------------------------------|-----------|
| `POST`  | `/log`  | Write log entry. Body: `{ service, level, message, extra? }` | `boolean` |

#### TUI

| Method  | Path                      | Description                           | Response             |
|---------|---------------------------|---------------------------------------|----------------------|
| `POST`  | `/tui/append-prompt`      | Append text to the prompt             | `boolean`            |
| `POST`  | `/tui/open-help`          | Open the help dialog                  | `boolean`            |
| `POST`  | `/tui/open-sessions`      | Open the session selector             | `boolean`            |
| `POST`  | `/tui/open-themes`        | Open the theme selector               | `boolean`            |
| `POST`  | `/tui/open-models`        | Open the model selector               | `boolean`            |
| `POST`  | `/tui/submit-prompt`      | Submit the current prompt             | `boolean`            |
| `POST`  | `/tui/clear-prompt`       | Clear the prompt                      | `boolean`            |
| `POST`  | `/tui/execute-command`    | Execute a command (`{ command }`)     | `boolean`            |
| `POST`  | `/tui/show-toast`         | Show toast (`{ title?, message, variant }`) | `boolean`    |
| `GET`   | `/tui/control/next`       | Wait for the next control request     | Control request object |
| `POST`  | `/tui/control/response`   | Respond to a control request (`{ body }`) | `boolean`    |

#### Auth

| Method | Path          | Description                                        | Response  |
|--------|---------------|----------------------------------------------------|-----------|
| `PUT`  | `/auth/:id`   | Set authentication credentials. Body must match provider schema | `boolean` |

#### Events

| Method | Path      | Description                                                                  | Response                 |
|--------|-----------|------------------------------------------------------------------------------|--------------------------|
| `GET`  | `/event`  | Server-sent events stream. First event is `server.connected`, then bus events | Server-sent events stream |

#### Docs

| Method | Path    | Description                | Response                         |
|--------|---------|----------------------------|----------------------------------|
| `GET`  | `/doc`  | OpenAPI 3.1 specification  | HTML page with OpenAPI spec      |

---

## 9. Config

### 9.1 Format

OpenCode supports both **JSON** and **JSONC** (JSON with Comments) formats.

`opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-sonnet-4-5",
  "autoupdate": true,
  "server": {
    "port": 4096,
  },
}
```

### 9.2 Locations

Configuration files are **merged together**, not replaced. Settings from the following config locations are combined. Later configs override earlier ones only for conflicting keys. Non-conflicting settings from all configs are preserved.

#### Precedence Order

Config sources are loaded in this order (later sources override earlier ones):

1. **Remote config** (from `.well-known/opencode`) — organizational defaults
2. **Global config** (`~/.config/opencode/opencode.json`) — user preferences
3. **Custom config** (`OPENCODE_CONFIG` env var) — custom overrides
4. **Project config** (`opencode.json` in project) — project-specific settings
5. **`.opencode` directories** — agents, commands, plugins
6. **Inline config** (`OPENCODE_CONFIG_CONTENT` env var) — runtime overrides
7. **Managed config files** (`/Library/Application Support/opencode/` on macOS) — admin-controlled
8. **macOS managed preferences** (`.mobileconfig` via MDM) — highest priority, not user-overridable

> **Note:** The `.opencode` and `~/.config/opencode` directories use **plural names** for subdirectories: `agents/`, `commands/`, `modes/`, `plugins/`, `skills/`, `tools/`, and `themes/`. Singular names (e.g., `agent/`) are also supported for backwards compatibility.

#### Remote Config

Organizations can provide default configuration via the `.well-known/opencode` endpoint. This is fetched automatically when you authenticate with a provider that supports it.

Remote config from `.well-known/opencode`:

```json
{
  "mcp": {
    "jira": {
      "type": "remote",
      "url": "https://jira.example.com/mcp",
      "enabled": false
    }
  }
}
```

Override in local config:

```json
{
  "mcp": {
    "jira": {
      "type": "remote",
      "url": "https://jira.example.com/mcp",
      "enabled": true
    }
  }
}
```

#### Global Config

Place your global OpenCode config in `~/.config/opencode/opencode.json`. Use global config for user-wide server/runtime preferences like providers, models, and permissions.

For TUI-specific settings, use `~/.config/opencode/tui.json`.

Global config overrides remote organizational defaults.

#### Per Project

Add `opencode.json` in your project root. Project config has the highest precedence among standard config files — it overrides both global and remote configs.

For project-specific TUI settings, add `tui.json` alongside it.

OpenCode looks for a config file in the current directory or traverses up to the nearest Git directory. This is safe to check into Git and uses the same schema as the global one.

#### Custom Path

Specify a custom config file path using the `OPENCODE_CONFIG` environment variable:

```bash
export OPENCODE_CONFIG=/path/to/my/custom-config.json
opencode run "Hello world"
```

Custom config is loaded between global and project configs in the precedence order.

#### Custom Directory

Specify a custom config directory using the `OPENCODE_CONFIG_DIR` environment variable:

```bash
export OPENCODE_CONFIG_DIR=/path/to/my/config-directory
opencode run "Hello world"
```

The custom directory is loaded after the global config and `.opencode` directories, so it **can override** their settings.

#### Managed Settings

Organizations can enforce configuration that users cannot override. Managed settings are loaded at the highest priority tier.

**File-based:**

| Platform | Path                                    |
|----------|-----------------------------------------|
| macOS    | `/Library/Application Support/opencode/` |
| Linux    | `/etc/opencode/`                         |
| Windows  | `%ProgramData%\opencode`                 |

These directories require admin/root access to write, so users cannot modify them.

**macOS managed preferences (.mobileconfig):**

On macOS, OpenCode reads managed preferences from the `ai.opencode.managed` preference domain. Deploy a `.mobileconfig` via MDM (Jamf, Kandji, FleetDM).

OpenCode checks these paths:

1. `/Library/Managed Preferences/<user>/ai.opencode.managed.plist`
2. `/Library/Managed Preferences/ai.opencode.managed.plist`

Creating a `.mobileconfig`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadType</key>
      <string>ai.opencode.managed</string>
      <key>PayloadIdentifier</key>
      <string>com.example.opencode.config</string>
      <key>PayloadUUID</key>
      <string>GENERATE-YOUR-OWN-UUID</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
      <key>share</key>
      <string>disabled</string>
      <key>server</key>
      <dict>
        <key>hostname</key>
        <string>127.0.0.1</string>
      </dict>
      <key>permission</key>
      <dict>
        <key>*</key>
        <string>ask</string>
        <key>bash</key>
        <dict>
          <key>*</key>
          <string>ask</string>
          <key>rm -rf *</key>
          <string>deny</string>
        </dict>
      </dict>
    </dict>
  </array>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadIdentifier</key>
  <string>com.example.opencode</string>
  <key>PayloadUUID</key>
  <string>GENERATE-YOUR-OWN-UUID</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>
```

**Deploying via MDM:**

- **Jamf Pro:** Computers > Configuration Profiles > Upload > scope to target devices or smart groups
- **FleetDM:** Add the `.mobileconfig` to your gitops repo under `mdm.macos_settings.custom_settings` and run `fleetctl apply`

**Verifying on a device:**

```bash
opencode debug config
```

### 9.3 Schema

The server/runtime config schema is defined in [`opencode.ai/config.json`](https://opencode.ai/config.json).

TUI config uses [`opencode.ai/tui.json`](https://opencode.ai/tui.json).

#### TUI

Use a dedicated `tui.json` (or `tui.jsonc`) file for TUI-specific settings.

`tui.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "scroll_speed": 3,
  "scroll_acceleration": {
    "enabled": true
  },
  "diff_style": "auto",
  "mouse": true
}
```

Use `OPENCODE_TUI_CONFIG` to point to a custom TUI config file.

Legacy `theme`, `keybinds`, and `tui` keys in `opencode.json` are deprecated and automatically migrated when possible.

#### Server

```json
{
  "$schema": "https://opencode.ai/config.json",
  "server": {
    "port": 4096,
    "hostname": "0.0.0.0",
    "mdns": true,
    "mdnsDomain": "myproject.local",
    "cors": ["http://localhost:5173"]
  }
}
```

| Option        | Description                                                                         |
|---------------|-------------------------------------------------------------------------------------|
| `port`        | Port to listen on                                                                   |
| `hostname`    | Hostname to listen on. When `mdns` is enabled and no hostname is set, defaults to `0.0.0.0` |
| `mdns`        | Enable mDNS service discovery                                                       |
| `mdnsDomain`  | Custom domain name for mDNS service. Defaults to `opencode.local`                   |
| `cors`        | Additional origins to allow for CORS. Must be full origins (scheme + host + optional port) |

#### Tools

Manage the tools an LLM can use:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "tools": {
    "write": false,
    "bash": false
  }
}
```

#### Models

Configure providers and models:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {},
  "model": "anthropic/claude-sonnet-4-5",
  "small_model": "anthropic/claude-haiku-4-5"
}
```

`small_model` configures a separate model for lightweight tasks like title generation. By default, OpenCode tries to use a cheaper model if one is available.

Provider options can include `timeout`, `chunkTimeout`, and `setCacheKey`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "anthropic": {
      "options": {
        "timeout": 600000,
        "chunkTimeout": 30000,
        "setCacheKey": true
      }
    }
  }
}
```

| Option           | Description                                           |
|------------------|-------------------------------------------------------|
| `timeout`        | Request timeout in milliseconds (default: 300000). Set to `false` to disable |
| `chunkTimeout`   | Timeout in milliseconds between streamed response chunks |
| `setCacheKey`    | Ensure a cache key is always set for designated provider |

**Amazon Bedrock-specific options:**

```json
{
  "provider": {
    "amazon-bedrock": {
      "options": {
        "region": "us-east-1",
        "profile": "my-aws-profile",
        "endpoint": "https://bedrock-runtime.us-east-1.vpce-xxxxx.amazonaws.com"
      }
    }
  }
}
```

| Option     | Description                                                                                      |
|------------|--------------------------------------------------------------------------------------------------|
| `region`   | AWS region for Bedrock (defaults to `AWS_REGION` env var or `us-east-1`)                         |
| `profile`  | AWS named profile from `~/.aws/credentials` (defaults to `AWS_PROFILE` env var)                  |
| `endpoint` | Custom endpoint URL for VPC endpoints. Alias for `baseURL`. If both specified, `endpoint` wins   |

#### Themes

Set UI theme in `tui.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "theme": "tokyonight"
}
```

#### Agents

Configure specialized agents:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "agent": {
    "code-reviewer": {
      "description": "Reviews code for best practices and potential issues",
      "model": "anthropic/claude-sonnet-4-5",
      "prompt": "You are a code reviewer. Focus on security, performance, and maintainability.",
      "tools": {
        "write": false,
        "edit": false,
      },
    },
  },
}
```

Also define agents using markdown files in `~/.config/opencode/agents/` or `.opencode/agents/`.

#### Default Agent

Set the default agent used when none is explicitly specified:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "default_agent": "plan"
}
```

The default agent must be a primary agent (not a subagent). If the specified agent doesn't exist or is a subagent, OpenCode will fall back to `"build"` with a warning.

Applies across all interfaces: TUI, CLI (`opencode run`), desktop app, and GitHub Action.

#### Sharing

Configure the share feature:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "share": "manual"
}
```

| Value       | Description                                |
|-------------|--------------------------------------------|
| `"manual"`  | Allow manual sharing via commands (default) |
| `"auto"`    | Automatically share new conversations      |
| `"disabled"`| Disable sharing entirely                   |

#### Commands

Configure custom commands for repetitive tasks:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "command": {
    "test": {
      "template": "Run the full test suite with coverage report and show any failures.\nFocus on the failing tests and suggest fixes.",
      "description": "Run tests with coverage",
      "agent": "build",
      "model": "anthropic/claude-haiku-4-5",
    },
    "component": {
      "template": "Create a new React component named $ARGUMENTS with TypeScript support.\nInclude proper typing and basic structure.",
      "description": "Create a new component",
    },
  },
}
```

Also define commands using markdown files in `~/.config/opencode/commands/` or `.opencode/commands/`.

#### Keybinds

Customize keybinds in `tui.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "keybinds": {}
}
```

#### Snapshot

OpenCode uses snapshots to track file changes during agent operations, enabling undo and revert. Snapshots are enabled by default.

For large repositories or many submodules, the snapshot system can cause slow indexing and significant disk usage. Disable with:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "snapshot": false
}
```

Disabling snapshots means changes made by the agent cannot be rolled back through the UI.

#### Autoupdate

OpenCode will automatically download updates on startup. Disable:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "autoupdate": false
}
```

Set to `"notify"` to be notified of new versions without auto-installing (only works if not installed via a package manager).

#### Formatters

Configure code formatters:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": {
    "prettier": {
      "disabled": true
    },
    "custom-prettier": {
      "command": ["npx", "prettier", "--write", "$FILE"],
      "environment": {
        "NODE_ENV": "development"
      },
      "extensions": [".js", ".ts", ".jsx", ".tsx"]
    }
  }
}
```

#### Permissions

By default, opencode **allows all operations** without requiring explicit approval:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "edit": "ask",
    "bash": "ask"
  }
}
```

See [Section 6: Permissions](#6-permissions) for full details.

#### Compaction

Control context compaction behavior:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "compaction": {
    "auto": true,
    "prune": true,
    "reserved": 10000
  }
}
```

| Option     | Description                                                   |
|------------|---------------------------------------------------------------|
| `auto`     | Automatically compact the session when context is full (default: `true`) |
| `prune`    | Remove old tool outputs to save tokens (default: `true`)     |
| `reserved` | Token buffer for compaction. Leaves enough window to avoid overflow |

#### Watcher

Configure file watcher ignore patterns:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "watcher": {
    "ignore": ["node_modules/**", "dist/**", ".git/**"]
  }
}
```

Patterns follow glob syntax. Use this to exclude noisy directories from file watching.

#### MCP Servers

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {}
}
```

#### Plugins

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-helicone-session", "@my-org/custom-plugin"]
}
```

See [Section 1: Plugins](#1-plugins) for full details.

#### Instructions

Configure instructions for the model:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "instructions": ["CONTRIBUTING.md", "docs/guidelines.md", ".cursor/rules/*.md"]
}
```

Takes an array of paths and glob patterns to instruction files.

#### Disabled Providers

Disable providers that are loaded automatically:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "disabled_providers": ["openai", "gemini"]
}
```

When a provider is disabled:

- It won't be loaded even if environment variables are set
- It won't be loaded even if API keys are configured through the `/connect` command
- The provider's models won't appear in the model selection list

> **Note:** `disabled_providers` takes priority over `enabled_providers`.

#### Enabled Providers

Specify an allowlist of providers:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "enabled_providers": ["anthropic", "openai"]
}
```

When set, only the specified providers will be enabled and all others will be ignored.

> **Note:** `disabled_providers` takes priority over `enabled_providers`. If a provider appears in both, `disabled_providers` wins.

#### Experimental

```json
{
  "$schema": "https://opencode.ai/config.json",
  "experimental": {}
}
```

Experimental options are not stable. They may change or be removed without notice.

### 9.4 Variables

You can use variable substitution in your config files to reference environment variables and file contents.

#### Env Vars

Use `{env:VARIABLE_NAME}` to substitute environment variables:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "{env:OPENCODE_MODEL}",
  "provider": {
    "anthropic": {
      "models": {},
      "options": {
        "apiKey": "{env:ANTHROPIC_API_KEY}"
      }
    }
  }
}
```

If the environment variable is not set, it will be replaced with an empty string.

#### Files

Use `{file:path/to/file}` to substitute the contents of a file:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "instructions": ["./custom-instructions.md"],
  "provider": {
    "openai": {
      "options": {
        "apiKey": "{file:~/.secrets/openai-key}"
      }
    }
  }
}
```

File paths can be:

- Relative to the config file directory
- Or absolute paths starting with `/` or `~`

Useful for:

- Keeping sensitive data like API keys in separate files
- Including large instruction files without cluttering your config
- Sharing common configuration snippets across multiple config files
