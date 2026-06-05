---
date: 2026-06-05
topic: session-title-generation-problems
status: completed
mode: context-gathering
sources: 6
---

## Context Report: Session Title Generation — Root Cause Analysis

### Why This Was Gathered
用户反馈生成的 session 标题质量极差：如 "implement 项目名" / "enhanced 项目名" 等无信息量标题。需要定位是 prompt 问题还是上下文获取问题。

### Summary
**根因是 prompt 设计问题，不是上下文获取问题。** System prompt 的指令引导模型产出泛泛的动作动词+项目名组合，而非描述具体工作内容的标题。上下文获取逻辑是完整的，prompt 和 assistant snippet 都有传入。

### Key Findings

#### 1. System Prompt 引导方向错误
- **位置**: `src/core/session-title-generator.ts:73`
- **当前内容**: `"Generate a concise work-session title. Return only the title text. Use 2 to 5 words, imperative or task-focused, with no quotes or trailing punctuation."`
- **问题**:
  - `"imperative or task-focused"` → 模型倾向于用 "Implement / Enhance / Fix / Build" 等泛泛动词开头
  - `"2 to 5 words"` → 太短，无法表达具体内容
  - `"concise"` + `"work-session title"` → 模型理解为"给一个分类标签"而非"描述具体做了什么"
  - **没有正面/负面示例** → 模型无从判断好标题和坏标题的区别

#### 2. User Prompt 包含冗余信息，有效信号被稀释
- **位置**: `src/core/session-title-generator.ts:82-94`
- **当前构建**:
  ```
  Project: ${projectName}          ← 模型偷懒用项目名凑字数
  Session provider: ${sessionType} ← 与标题无关
  User prompt: ${prompt}           ← 有用信号
  Assistant summary: ${snippet}    ← 有用信号
  ```
- **问题**: 项目名被传入后，模型直接拼 `动词 + 项目名` 就能"满足" 2-5 词要求，不再努力理解实际内容

#### 3. 上下文获取逻辑本身是完整的
- **位置**: `src/main/session-title-controller.ts:176-196`
- `deriveTitleContextPatch` 能正确捕获 prompt 和 snippet
- `maybeAutoGenerateForCompletedTurn` 在首个 turn 完成后触发
- 上下文传递链路完整，不存在数据丢失

#### 4. 默认标题方案作为 fallback 是合理的
- **位置**: `src/core/work-session-title.ts:4-19`
- Shell: `shell-{n}`, Provider: `{prefix}-{projectName}`
- 这部分不是问题所在

### Evidence Chain
| Finding | Source | Location |
|---------|--------|----------|
| System prompt 引导泛泛动词 | session-title-generator.ts | :73 |
| User prompt 传项目名导致偷懒 | session-title-generator.ts | :89 |
| 2-5 词限制太短 | session-title-generator.ts | :73 |
| 上下文捕获逻辑完整 | session-title-controller.ts | :176-196 |
| 自动生成时机正确 | session-title-controller.ts | :70-96 |
| 默认标题策略合理 | work-session-title.ts | :4-19 |

### Risks / Unknowns
- [?] assistantSnippet 的具体截取策略和长度限制未知，可能过于简短
- [!] 修改 prompt 后需要更新测试用例中的断言
