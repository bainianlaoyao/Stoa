# LINUX DO Promo Draft — 2026-05-24

## Current Rule Summary

As of `2026-05-24`, the Linux.do open-source promotion path requires:

- use the `#开源推广` tag
- the project must be fully open source
- the main project README must link back to `https://linux.do`
- AI-generated or AI-polished post content must be posted as screenshots, not raw text
- the built-in open-source promotion declaration template must be inserted in the editor
- posts go through moderation before publication

## Current Blocking Issue

The repository currently has:

- `LICENSE`: present
- `README.md` Linux.do link-back: added in this prep pass
- `README.zh-CN.md` Linux.do link-back: added in this prep pass

That means the main repository blockers for `#开源推广` are cleared.

The remaining pre-publish requirement is procedural:

- if the final post body is AI-assisted, convert that body into screenshots before posting
- insert the built-in Linux.do `开源推广` declaration template in the editor

## README Link-Back Suggestion

Add a visible acknowledgment in the main `README.md`, for example:

```md
## Community

This project actively recognizes and participates in the [LINUX DO community](https://linux.do).
```

Or in Chinese:

```md
## 社区

本项目认可并积极参与 [LINUX DO 社区](https://linux.do)。
```

## Posting Notes

- Do **not** copy AI-written text directly into Linux.do as normal text.
- If you use the draft below as-is, convert it into screenshots and mark the AI-content item accordingly.
- If you rewrite it yourself in your own words, you can post the rewritten body as plain text.
- Use the editor's built-in `开源推广发帖模板`; do not rely on a hand-copied version.

## Suggested Title

`Stoa：一个本地优先的 AI CLI 多项目 / 多会话工作台`

## Human-Written Forum Version

Use this **after** the built-in `开源推广` declaration block.

```text
最近一直在折腾一个本地 AI CLI 工作台，名字叫 Stoa。

我自己现在高频用 Claude Code、Codex、OpenCode 这类 CLI 工具写东西，时间一长最烦的不是模型本身，而是会话一多以后真的很乱：项目切换乱、终端标签页乱、当前进度乱，重开以后恢复路径也乱。

Stoa 基本就是冲着这件事做的。我不想继续靠一堆终端窗口、手工记忆和各种脏办法去管这些会话，所以做了一个本地桌面容器，把这些真实 CLI 会话收进一个工作区里。

它的定位比较克制：

- 不是 IDE
- 不是云端 Agent 平台
- 不是聊天框

更接近一个本地调度台。

现在主要做这些事情：

- 多项目 / 多工作区切换
- 多 CLI provider 管理
- 后台会话保持
- 会话恢复
- 结构化状态侧信道
- 真实终端承载

我自己比较在意的不是面板堆功能，而是这条路径能不能稳一点、能不能长期用。所以项目里测试也压得比较重，包括 Electron E2E、生成式 Playwright journey 和行为覆盖检查。

项目还在持续演进阶段，不过核心方向已经比较明确了：就是把 AI CLI 时代的多会话编程工作流，尽量从“临时终端体验”往“稳定、可恢复的本地工作台”推。

如果这里本身就在高频用 Claude Code / Codex / OpenCode，也欢迎直接来挑毛病，尤其是多会话、多项目、状态恢复这类真实工作流的问题。

GitHub：
https://github.com/bainianlaoyao/Stoa

Release：
https://github.com/bainianlaoyao/Stoa/releases
```

## Shorter Forum Version

```text
最近做了一个本地 AI CLI 工作台，叫 Stoa。

它主要想解决一个很具体的问题：Claude Code、Codex、OpenCode 这类 CLI 工具一旦会话变多，项目切换、终端状态和恢复路径就会越来越乱。

Stoa 不替代 IDE，也不做云端平台，而是把真实 CLI 会话放进一个本地桌面工作区里统一管理。

当前重点：

- 多项目 / 多工作区
- 多 CLI provider
- 后台会话保持
- 会话恢复
- 结构化状态侧信道

GitHub：
https://github.com/bainianlaoyao/Stoa

Release：
https://github.com/bainianlaoyao/Stoa/releases
```

## Pre-Publish Checklist

- `README.md` contains the Linux.do acknowledgment link
- use the editor's `开源推广发帖模板`
- set every declaration item to `是`
- add the `#开源推广` tag
- if you paste this document's copy directly, render it as screenshots before posting
- if you rewrite it yourself, plain text is acceptable
- do not mention any paid plan, donation funnel, QQ/TG group, or off-site community diversion
- expect moderation before publication

## Sources

- `research/2026-05-24-linux-do-promotion-rules.md`
- `research/2026-04-27-stoa-promotion-platform-copy.md`
