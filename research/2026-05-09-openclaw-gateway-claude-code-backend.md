
---
date: 2026-05-09
topic: openclaw-gateway-claude-code-backend-compatibility
status: completed
mode: context-gathering
sources: 15
---

## Context Report: OpenClaw风格Gateway兼容Claude Code作为执行后端的可行性

### Why This Was Gathered
评估是否可以将OpenClaw风格的Gateway（多渠道接入+统一会话管理的AI Agent框架）与Claude Code集成，使Claude Code作为底层执行后端（类似OpenClaw使用Pi Agent的方式）。此研究为后续架构设计决策提供事实基础。

### Summary
**结论：技术上可行，但需要显著的适配工作。** OpenClaw的Gateway架构将控制平面与执行平面分离，执行层使用`@mariozechner/pi-ai`（Pi Agent）SDK。Claude Code自v2.1起提供了Agent SDK（Python/TypeScript/CLI headless模式），包含了同构的agent loop、工具系统和上下文管理。关键"替换"路径是将OpenClaw Gateway的`activeSession.prompt()`调用重定向到Claude Code的Agent SDK（或headless CLI `claude -p`），同时保持Gateway层全部的多渠道、认证、会话管理能力不变。主要挑战在于会话持久化格式不兼容、工具系统映射复杂度、以及Claude Code的非交互模式的成熟度。

### Key Findings

#### 1. OpenClaw架构概要

OpenClaw是一个**双进程分层架构**：

| 层级 | 组件 | 职责 |
|------|------|------|
| **控制平面** | Gateway进程 (单进程, 默认端口18789) | WebSocket通信、多渠道适配(50+平台)、认证/配对、路由规则、会话管理 |
| **执行平面** | Agent Runtime (嵌入式) | 推理、工具调用、Agent Loop (ReAct范式) |
| **可选** | Sandbox (Docker隔离层) | 工具执行安全边界 |
| **可选** | Remote Node | 分布式节点，手机/服务器上的执行端点 |

关键执行链路：
```
用户消息 → Channel Plugin(适配翻译) → Gateway(路由/认证) 
→ Agent Loop(ReAct迭代) → Pi Agent SDK(推理+工具调用) 
→ Sandbox(安全检查) → 工具执行 → 结果返回 → Channel Plugin → 用户
```

**GateWay的核心设计哲学**：
- 控制平面与执行平面分离
- 嵌入式Agent（非子进程spawn），直接使用SDK创建会话：`activeSession.prompt(...)`
- 单一进程多路复用（一个Gateway管理所有Channel）
- 插件化架构（每个平台实现一个`ChannelPlugin`接口）
- 单端口服务(WebSocket RPC + HTTP API + Canvas Host)

#### 2. Claude Code作为执行后端的可行性

Claude Code提供了**三种程序化调用方式**：

| 方式 | 接口 | 适用场景 |
|------|------|----------|
| **Headless CLI** | `claude -p "prompt" --allowedTools "Read,Edit,Bash"` | 脚本/CI/CD、简单的一次性查询 |
| **Agent SDK (Python)** | `@anthropic-ai/claude-agent` (Python包) | 完全程序化控制、结构化输出、自定义工具回调 |
| **Agent SDK (TypeScript)** | `@anthropic-ai/claude-agent` (TS包) | 同上，适合Node.js项目 |

Agent SDK提供的能力：
- 与Claude Code交互模式相同的**Agent Loop**（推理→工具调用→结果→再推理，直到任务完成）
- 相同的**工具系统**（Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch等30+内置工具）
- **上下文管理**（200K token上下文窗口）
- **MCP集成**（Model Context Protocol服务器连接）
- **会话管理**（支持session持久化和恢复）
- **权限/permission回调钩子**
- **结构化输出**（SDK级别，非CLI）

**Headless CLI的`-p`模式本质上是SDK CLI包装**：SDK文档明确说明 "The CLI was previously called 'headless mode.' The -p flag and all CLI options work the same way."

#### 3. OpenClaw Pi Agent vs Claude Code Agent SDK 对比

| 维度 | OpenClaw Pi Agent | Claude Code Agent SDK |
|------|-------------------|----------------------|
| **核心SDK** | `@mariozechner/pi-ai` | `@anthropic-ai/claude-agent` |
| **设计哲学** | 极简主义：仅4个工具(Read/Write/Edit/Bash)，<1000 tokens system prompt | 全功能：30+工具，丰富的hooks/plugins/skills体系 |
| **工具调用** | embedded SDK session调用 | 同构：SDK session调用 |
| **会话存储** | `~/.openclaw/agents/<agentId>/sessions/<SessionId>.jsonl` | `~/.claude/sessions/` (内部格式) |
| **模型提供商** | 多提供商（Anthropic, OpenAI, Gemini, OpenRouter等） | 主要面向Anthropic，但支持`ANTHROPIC_BASE_URL`配置第三方兼容API |
| **Agent Loop** | ReAct范式，原子化Turn循环 | 相同的ReAct范式，双层控制流 |
| **安全/权限** | Sandbox (Docker隔离)，工具审批机制 | 权限系统（ask/allow/deny），hooks机制 |
| **MCP支持** | 通过适配器接入MCP | 原生MCP支持 |

#### 4. 兼容方案的核心切入点

OpenClaw的Gateway与Agent Runtime之间是**松耦合**的。Gateway的核心职责是：
1. 渠道消息接收和格式翻译（ChannelPlugin）
2. 会话路由和管理
3. 调用Agent Runtime执行推理
4. 结果投递回渠道

关键接口是第3步的**推理调用**。在OpenClaw源码中，这表现为：
```javascript
// OpenClaw执行层的关键调用
activeSession.prompt(message)  // Pi Agent SDK的调用
```

替换为Claude Code Agent SDK的等价调用：
```python
# Claude Code Agent SDK (Python)
from claude_agent import ClaudeAgent

agent = ClaudeAgent(
    allowed_tools=["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    permission_mode="auto",
    working_dir="/path/to/project"
)

result = agent.prompt(message)  # 同构的调用接口！
```

或者使用headless CLI方式：
```bash
claude -p "用户消息" --allowedTools "Read,Edit,Bash" --output-format json
```

#### 5. 技术挑战与风险

| 挑战 | 严重程度 | 详情 |
|------|----------|------|
| **会话格式不兼容** | 🔴 高 | OpenClaw使用JSONL格式存储会话（`~/.openclaw/agents/<agentId>/sessions/<SessionId>.jsonl`），Claude Code使用内部二进制/JSON格式。需要实现会话转换/同步层 |
| **工具系统映射** | 🟡 中 | OpenClaw仅使用4个核心工具（CRUD原语），Claude Code有30+工具。需要工具白名单限制（`--allowedTools`）来匹配Pi Agent的极简主义设计。反向则不兼容——OpenClaw无法直接映射Claude Code的高级工具（如Agent/TeamCreate等） |
| **Sandbox差异** | 🟡 中 | OpenClaw有Docker沙箱隔离层，Claude Code的权限系统是不同模型。需要额外一层安全适配 |
| **多提供商支持** | 🟢 低 | Claude Code通过`ANTHROPIC_BASE_URL`环境变量支持第三方兼容API（GLM、OpenRouter等），配置灵活 |
| **Headless模式成熟度** | 🟡 中 | `claude -p`模式适合单次查询，但对于持续的多轮对话式Agent Loop，SDK模式更合适。SDK v2.1.118刚刚稳定，生产级可靠性待验证 |
| **状态管理** | 🔴 高 | OpenClaw Gateway本身维护会话状态、设备配对、心跳检测。如果替换执行后端，Gateway的状态管理与Claude Code的session管理需要协调 |
| **性能开销** | 🟡 中 | Headless CLI每次调用启动新进程（冷启动开销）；SDK模式在进程内运行，性能更好但需要管理生命周期 |

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| OpenClaw采用双进程分层架构，Gateway+Agent Runtime | CSDN架构深度解析 | https://blog.csdn.net/Lucas55555555/article/details/159081585 |
| OpenClaw Gateway = 单一进程，默认WebSocket端口18789 | 腾讯云开发者 | https://cloud.tencent.com/developer/article/2652974 |
| OpenClaw执行层使用嵌入式Agent (`@mariozechner/pi-ai`)，非子进程 | 腾讯云开发者 | https://cloud.tencent.com/developer/article/2652974 |
| Pi Agent仅4个工具(Read/Write/Edit/Bash)，极简设计 | 腾讯新闻 | https://so.html5.qq.com/page/real/search_news?docid=70000021_09369c88dce41252 |
| Claude Code Agent SDK 提供Python/TypeScript/CLI三种方式 | 博客园(官方文档翻译) | https://www.cnblogs.com/elesos/p/19550311 |
| Agent SDK = headless mode的正式名称，`claude -p`是其CLI包装 | CSDN程序化调用指南 | https://blog.csdn.net/zhangmeijia5/article/details/159793477 |
| Claude Code支持`ANTHROPIC_BASE_URL`配置第三方API | CSDN国内配置指南 | https://blog.csdn.net/ofoxcoding/article/details/160146925 |
| OpenClaw会话存储在`~/.openclaw/agents/<agentId>/sessions/<SessionId>.jsonl` | 知乎技术分析 | https://zhuanlan.zhihu.com/p/2003914477209413004 |
| Claude Code源码使用Bun+TypeScript+React+Ink | CSDN源码分析 | https://blog.csdn.net/rengang66/article/details/160068870 |
| OpenClaw技术栈: Node.js 24+, TypeScript 6.0+, pnpm 10+, Hono框架 | CSDN源码学习 | https://blog.csdn.net/cosmoslife/article/details/160024137 |
| OpenClaw通过`openclaw.json`管理模型配置和Agent定义 | CSDN模型接入分析 | https://blog.csdn.net/2402_86603803/article/details/158966088 |
| Claude Code支持MCP原生集成，OpenClaw通过适配器接入 | 搜狐安全分析 | https://so.html5.qq.com/page/real/search_news?docid=70000021_80169df8d1402552 |
| OpenClaw执行链路：Channel→Gateway→Agent Loop→Sandbox→工具 | CSDN架构详解 | https://blog.csdn.net/qq_35812205/article/details/160593084 |
| Claude Code Agent SDK提供结构化输出、tool approval callbacks | 博客园SDK文档 | https://www.cnblogs.com/elesos/p/19550311 |
| Claude Code源码51.2万行TypeScript (v2.1.88泄露) | CSDN源码分析 | https://blog.csdn.net/qq_39370934/article/details/159766534 |

### 架构方案建议

#### 方案A: SDK嵌入模式（推荐）

```
┌──────────────────────────────────────────────────┐
│                 OpenClaw Gateway                  │
│  (保留全部Channel/认证/路由/会话管理能力)          │
│                                                    │
│  ┌──────────────────────────────────────────────┐ │
│  │          Agent Runtime Adapter (新)           │ │
│  │  ┌──────────────────────────────────────┐    │ │
│  │  │  Claude Agent SDK Client             │    │ │
│  │  │  (替代 @mariozechner/pi-ai)          │    │ │
│  │  │  - session.prompt()                  │    │ │
│  │  │  - tool callback mapping             │    │ │
│  │  │  - session state adapter             │    │ │
│  │  └──────────────────────────────────────┘    │ │
│  └──────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
                          │
                          ▼
              ┌─────────────────────┐
              │  Claude Code Agent   │
              │  (Python/TS SDK)     │
              │  - 30+ tools         │
              │  - MCP integration   │
              │  - 200K context      │
              └─────────────────────┘
```

**优点**：
- Gateway层改动最小（仅替换执行引擎调用）
- 保持Gateway全部现有功能
- 可以渐进迁移（按Agent逐个切流）
- 支持会话状态的双向同步

**实现工作量估算**：
- Adapter核心：2-3周
- 会话格式转换：1-2周
- 工具映射与白名单：1周
- 测试与验证：2周
- 总计：约6-8周

#### 方案B: Headless CLI调用模式

```bash
# Gateway收到消息后，通过子进程调用Claude Code
claude -p "用户消息" \
  --allowedTools "Read,Write,Edit,Bash" \
  --working-dir /path/to/workspace \
  --output-format json \
  --session-id <gateway-session-id>
```

**优点**：实现最简单，无需深入到SDK级别
**缺点**：每次调用的冷启动开销、会话连续性维护困难、错误处理复杂度高

#### 方案C: 完全替换模式

废弃OpenClaw Gateway，基于Claude Code SDK完全重写Gateway层。

**优点**：统一技术栈，最大灵活性
**缺点**：需要重新实现50+渠道适配、会话管理、设备配对、沙箱等，工作量极大（3-6个月），风险高

### Risks / Unknowns

- [!] **Claude Code Agent SDK稳定性**：SDK v2.1.x刚进入稳定阶段，API可能仍有breaking changes
- [!] **会话连续性问题**：Claude Code的session概念与OpenClaw的多轮对话模型可能存在语义差异。Claude Code的session更偏向"开发任务工作流"，而OpenClaw的session更偏向"持续闲聊+任务穿插"
- [!] **工具调用行为差异**：即使是相同的Read/Write/Edit/Bash四个原语，Pi Agent和Claude Code的实现细节（特别是Edit的精确字符串替换语义）可能不同
- [?] **多Agent协作**：Claude Code有TeamCreate/Agent机制支持多Agent，但与OpenClaw的多Agent模型（一个Gateway管理多个独立Agent）的映射关系需要进一步研究
- [?] **企业级部署**：方案在沙箱、审计、多租户方面能否满足企业需求，需要额外验证
- [?] **Claude Code非交互模式的生产级验证**：缺乏大规模生产环境中作为Gateway后端的参考案例

### 下一步建议

1. **概念验证(POC)**：使用方案B(headless CLI)快速验证基本可行性（1-2天）
2. **SDK深度评估**：用Python Agent SDK实现一个简化版的Channel→Agent→Response链路（1周）
3. **会话兼容性测试**：验证OpenClaw JSONL格式 ←→ Claude Code session格式的双向转换
4. **性能基准测试**：对比Pi Agent vs Claude Code Agent SDK在相同任务下的延迟和吞吐量
