---
date: 2026-05-08
topic: hermes-agent-native-windows-viability
status: completed
mode: context-gathering
sources: 7
---

## Context Report: Hermes Agent 原生 Windows 可运行性核实

### Why This Was Gathered
用于判断 Stoa 是否可以把上游 Hermes Agent 作为内嵌/托管能力，并在 Windows 上承诺 `uv run` 启动的可用性与支持边界。

### Summary
截至 2026-05-08，Hermes Agent 上游官方文档仍然明确声明“native Windows is not supported”，官方推荐路径是 WSL2。与此同时，上游仓库已经存在专门的 `install.ps1`，且在当前原生 Windows 机器上，`uv run hermes --help` 与 `uv run hermes-agent --help` 均可成功启动命令入口，说明“可运行”和“官方支持”已经分离。

更具体地说：原生 Windows 上的 `uv run` 已经足以拉起 Hermes CLI 入口，但当前实测仍暴露出真实兼容性问题，例如插件 YAML 读取触发 GBK/UTF-8 解码错误。这说明 Hermes 不是“完全不能在 Windows 上跑”，而是“上游尚未把 native Windows 打磨到可承诺全功能支持”的状态。

### Key Findings
- 官方 README 仍明确写明：Hermes 支持 Linux、macOS、WSL2、Termux；native Windows 不支持，建议使用 WSL2。
- 官方文档存在专门的 Windows (WSL2) 指南，且明确解释 Hermes 依赖 POSIX 环境、PTY、signals、UNIX sockets 等，因此把 Windows 方案定义为 WSL2，而不是 native port。
- 上游仓库已经包含专用的 Windows PowerShell 安装脚本 `scripts/install.ps1`，脚本会在 Windows 上安装 `uv`、Python、Node，并把 Hermes 安装到 `%LOCALAPPDATA%\hermes`，说明上游至少在探索或维护原生 Windows 安装路径。
- 上游 `pyproject.toml` 已为 `win32` 显式声明 PTY 依赖 `pywinpty`，说明代码层面不是完全忽略 Windows。
- 在当前原生 Windows 机器实测中，`uv run hermes --help` 成功输出完整 CLI 帮助，`uv run hermes-agent --help` 成功构建并启动 agent 入口，证明 `uv run` 本身不是阻塞点。
- 但同一次原生 Windows 实测中，Hermes 在解析多个 `plugin.yaml` 时出现 `gbk codec can't decode` 错误，属于真实的 Windows 兼容性缺陷，而不是“理论上应该可用”。
- 因此，截止今天更准确的判断是：Hermes 原生 Windows 具备“部分可运行性”，但不能把它视为已完成的、上游承诺的全功能稳定平台。

### Evidence Chain
| Finding | Source | Location |
|---------|--------|----------|
| README 明确声明 native Windows 不支持 | Hermes upstream README | https://github.com/NousResearch/hermes-agent/blob/main/README.md |
| 官方 Windows 路径是 WSL2 | Hermes Windows guide | https://raw.githubusercontent.com/NousResearch/hermes-agent/main/website/docs/user-guide/windows-wsl-quickstart.md |
| 文档解释为何不是 native Windows，而是依赖 POSIX/PTY/signals | Hermes Windows guide | https://raw.githubusercontent.com/NousResearch/hermes-agent/main/website/docs/user-guide/windows-wsl-quickstart.md |
| 上游存在原生 Windows 安装脚本 | Hermes install.ps1 | https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.ps1 |
| 上游对 win32 显式声明 `pywinpty` 依赖 | Hermes pyproject.toml | https://raw.githubusercontent.com/NousResearch/hermes-agent/main/pyproject.toml |
| 本机原生 Windows 上 `uv run hermes --help` 成功 | Local shell evidence | `C:\Users\30280\AppData\Local\Temp\hermes-win-check\repo` 执行结果 |
| 本机原生 Windows 上 `uv run hermes-agent --help` 成功但伴随 GBK 解码错误 | Local shell evidence | `C:\Users\30280\AppData\Local\Temp\hermes-win-check\repo` 执行结果 |

### Risks / Unknowns
- [!] 不能把“命令入口可启动”误判成“完整 TUI / 插件 / hooks / dashboard / gateway / provider integrations 均可稳定运行”。当前证据只证明入口可跑，且已发现编码问题。
- [!] 官方文档与安装脚本并存，说明上游自身也处于过渡态。对产品承诺时必须区分“实验性 native Windows”与“正式支持平台”。
- [!] 当前实测没有完成 `hermes --tui` 的完整交互验证，也没有验证 dashboard、gateway、memory、MCP、voice 等附加能力在原生 Windows 上的状态。
- [?] 需要进一步查 issue / PR 才能知道这些 Windows 问题是否已有修复计划、是否只是编码/配置层适配问题。

## Context Handoff: Hermes Agent 原生 Windows 可运行性核实

Start here: `research/2026-05-08-hermes-agent-native-windows-viability.md`

Context only. Use the saved report as the source of truth.
