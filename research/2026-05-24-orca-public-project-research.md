---
date: 2026-05-24
topic: orca-public-project-research
status: completed
mode: context-gathering
sources: 6
---

## Context Report: Orca（stablyai/orca）公开项目调研

### Why This Was Gathered
评估公开项目 Orca (stablyai/orca) 的产品定位、功能范围和成熟度，以便与本地项目（Nautilus/Stoa）进行产品含义对比。

### Summary
Orca 是由 stablyai 开发的开源 **Agent Development Environment (ADE)**，定位为"AI 编码智能体的编排 IDE"。它让开发者能在独立 git worktree 中并行运行多个 AI 编码代理（Claude Code、Codex、Gemini 等 20+ 种），并提供内置 diff 审阅、GitHub 集成、浏览器预览和设计模式等功能。项目约 2 个月前创建（~2026年3月），非常活跃，MIT 许可，TypeScript/Electron 技术栈。

### Key Findings

#### 1. 产品定义
- **全称**: Orca — The AI Orchestrator for 100x builders
- **定位**: Agent Development Environment (ADE)，不是传统 IDE，而是"AI 编码代理的编排工作台"
- **核心主张**: 让已有 AI 订阅（Claude Code、Codex 等）的用户在一个桌面应用中并行编排多个代理
- **口号**: "Run Claude Code, Codex, or OpenCode side-by-side across repos — each in its own worktree, tracked in one place"
- **下载站**: onOrca.dev

#### 2. 核心功能
| 功能 | 描述 |
|------|------|
| **Worktree-native** | 每个任务独立 git worktree，无需 stash 或切分支 |
| **Multi-agent terminals** | 多个 AI 代理并排运行在标签页和分栏中，一目了然哪些活跃 |
| **Built-in source control** | 内置 diff 审阅、快速编辑、commit，不离开应用 |
| **GitHub integration** | PR、Issues、Actions 自动关联到 worktree |
| **SSH support** | 连接远程机器直接运行代理 |
| **Notifications** | 代理完成或需要关注时通知 |
| **AI Diff Annotation** | 直接在 AI 生成的 diff 上批注反馈，发回给代理修订 |
| **Hot Swap Codex Accounts** | 一键切换多个 Codex 账号 |
| **Per Worktree Browser & Design Mode** | 内置浏览器预览应用；Design Mode 点击 UI 元素直接丢入 AI 对话 |
| **Orca CLI** | 终端中的代理编排能力，让 AI 代理控制 IDE（添加项目、创建 worktree、更新 comment） |

#### 3. 支持的代理（20+）
Claude Code、Codex、Gemini、Pi、Hermes Agent、OpenCode、Goose、Amp、Auggie、Charm、Cline、Codebuff、Continue、Cursor、Droid、GitHub Copilot、Kilocode、Kimi、Kiro、Mistral Vibe、Qwen Code、Rovo Dev

官方声明支持"任何 CLI 代理"，不仅限于上述列表。

#### 4. 用户工作流
1. 打开一个项目
2. 为一个任务创建独立 worktree
3. 在该 worktree 的终端中启动 AI 代理（Claude Code、Codex 等）
4. 代理在隔离环境中工作
5. 通过内置 diff 查看器审阅 AI 生成的代码
6. 用 Annotation 功能在 diff 上批注反馈，发回给代理修订
7. Commit、创建 PR（GitHub 集成）
8. 多个代理并行跑在不同任务上

#### 5. "它不是什么"（官方声明）
- **不是模型** — 用户自带 Claude/Codex/等订阅
- **不是 git 替代** — 每个 worktree 是真实 git worktree，可随时用原生 git
- **不是仅云端** — 本地运行，远程代理通过 SSH 到用户自有的机器

#### 6. 技术栈
- TypeScript（Electron 桌面应用）
- 跨平台：macOS、Windows、Linux
- 有移动端伴侣 App（iOS、Android）

#### 7. 成熟度与采用指标
| 指标 | 数据 |
|------|------|
| GitHub Stars | ~2.2k |
| Forks | ~143 |
| 贡献者 | 56 人 |
| 创建时间 | ~2 个月前（约 2026年3月） |
| 最后提交 | 1 天前（非常活跃） |
| License | MIT |
| GitHub Trending | 尚未登上 Trending |
| 创始人 | Jinjing Liang (@JinjingLiang on X, @orca_build) |
| 社区 | Discord、X (Twitter)、Product Hunt |
| 发版节奏 | 日 ship，极高频率迭代 |

#### 8. 近期动态
- **AI Diff Annotation**: 新功能，直接在 diff 上批注反馈给代理
- **Hot Swap Codex Accounts**: 多账号一键切换
- **Design Mode**: 点击 UI 元素自动生成 AI 对话上下文
- **Orca CLI**: 新推出的终端编排工具
- **Browser Use**: 编码代理可直接控制 Orca 内置浏览器
- **Mobile App**: 推出伴侣移动端应用

### Evidence Chain
| Finding | Source | Location |
|---------|--------|----------|
| 产品定位与核心功能描述 | GitHub README | https://github.com/stablyai/orca |
| Stars/Forks/Contributors 指标 | TrendShift | https://trendshift.io/repositories/26256 |
| 官方网站内容与 use case | orcabuild.ai / onOrca.dev | https://orcabuild.ai/ |
| 移动端伴侣 App | mwm.ai | https://mwm.ai/apps/orca-ide/6766130217 |
| 第三方评测 | Vibe Coding Hub | https://vibecodinghub.org/tools/orca |
| 创始人社交媒体活动 | X/Twitter @orca_build | X 平台 |

### Risks / Unknowns
- [!] **极早期项目**: 仅约 2 个月历史，产品方向可能快速变化
- [!] **尚未 GitHub Trending**: 说明社区热度仍在早期增长阶段
- [?] **商业模式未知**: 开源 MIT，但尚未看到明确的商业化路径披露
- [?] **技术架构细节**: 未公开内部架构文档，Electron + TypeScript 是从项目语言推断
- [?] **与本地项目（Nautilus/Stoa）的产品重叠度**: 需要进一步对照分析，两者都涉及 AI 代理编排和 worktree 管理
