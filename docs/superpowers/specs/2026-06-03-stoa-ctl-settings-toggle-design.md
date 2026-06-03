# stoa-ctl 设置动态启停 — 设计

**日期**: 2026-06-03
**分支**: `feat/stoa-ctl-settings-toggle`
**状态**: 设计 → 实现

## 目标

让用户通过应用设置界面 **动态启停 stoa-ctl 命令行控制平面**。默认 **opt-in 关闭**,升级用户也不兼容迁移(默认 false)。关闭后,所有"暴露面"同步消失:shim 脚本被删除、PATH 注册被撤销、子会话 env 不再注入、HTTP `/ctl/*` 端点返回 503 disabled。

## 背景

`stoa-ctl` 是 Stoa 的外部控制 CLI(`tools/stoa-ctl/index.ts`),允许子会话、外部脚本通过 HTTP 调用控制平面。`src/core/stoa-ctl-shim.ts` 负责在启动时:

1. 创建 per-session 的 bin shim(`<userData>/bin/stoa-ctl{,.cmd}`)
2. 注册 system-level shim(`~/.stoa/bin/`)到用户 PATH
3. 把 `STOA_CTL_COMMAND`、`STOA_SESSION_ID`、`STOA_CTL_SESSION_TOKEN` 注入子会话 env
4. 注册 `/ctl/*` HTTP 路由

原型阶段,这些是默认开启的。本设计将其收束为单一设置项。

## 决策摘要

- **触发**: 应用设置界面动态切换(Settings drawer toggle)
- **默认**: opt-in,首次启动 `stoaCtlEnabled: false`
- **升级**: 不兼容迁移,旧 state 缺字段视为 `false`
- **联动**: 4 个暴露面统一联动关闭(shim 脚本、PATH 注册、子会话 env、HTTP 路由)
- **HTTP 关闭语义**: 路由保留,handler 返回 `503 {ok:false,error:{code:'disabled',message:'stoa-ctl is disabled in settings'}}`
- **truth source**: 主进程单例 `createStoaCtlGate()`,4 个调用点统一读 `gate.isEnabled()`
- **清理**: 关闭时主动 `unlink` 已写入的 shim 文件、从 PowerShell User PATH 与 shell rc 中撤销注册行

## 架构与数据流

### 新增模块: `src/core/stoa-ctl-feature.ts`

```ts
export interface StoaCtlGate {
  isEnabled(): boolean
  setEnabled(value: boolean): Promise<void>
  on(event: 'enabledChanged', listener: (enabled: boolean) => void): () => void
}

export function createStoaCtlGate(initialEnabled: boolean): StoaCtlGate
export function getStoaCtlGate(): StoaCtlGate  // 模块级 cache,主进程单例
export function setStoaCtlGate(gate: StoaCtlGate | null): void  // 测试 reset
```

- 单例形式:主进程内一份,模块级 cache(`cachedGate`)。`setStoaCtlGate(null)` 暴露给测试 reset
- 状态变更通过 `enabledChanged` 事件广播给 4 个联动点的订阅者
- `setEnabled(false)` 内部不主动清理 —— 清理由 main 监听 `enabledChanged` 触发,保持模块无副作用

### 数据流

```
[Renderer Settings Toggle]
        │ window.vibecoding.settings.update({ stoaCtlEnabled })
        ▼
[ipcMain handler 'settings:update']
        ▼ project-session-manager.updateSettings
        ▼ writePersistedState / writeGlobalState
        ▼ broadcast 'settings:updated' event
        │
        ▼ stoaCtlGate.setEnabled(value)
        │
   ┌────┴─────────────────────────────┐
   ▼ if false                          ▼ if true
  unregisterShim()                ensureStoaCtlShim()
  unregisterPath()                ensureStoaCtlSystemShim()
  (clean up residue)              (re-register)
        │
        ▼
  buildSessionCommandEnv() 在新建 session 时跳过 STOA_CTL_COMMAND 字段
  ctlRouter handler 在请求时查 gate.isEnabled(),关闭时返回 503
```

### 4 个联动点的契约

| 联动点 | 关闭时行为 | 文件 |
|--------|------------|------|
| per-session shim | 不创建;若 `<userData>/bin/stoa-ctl{,.cmd}` 存在则 `unlink` | `src/main/index.ts:893` 调用点 + `src/core/stoa-ctl-shim.ts:unregisterStoaCtlShim` |
| system shim + PATH | 不注册;撤销 `~/.stoa/bin` 的 PowerShell User PATH 段、shell rc 中的 `# stoa-ctl` 注入行 | `src/core/stoa-ctl-shim.ts:unregisterStoaCtlSystemShim` |
| 子会话 env | `buildSessionCommandEnv` 不输出 `STOA_CTL_COMMAND` / `STOA_CTL_SESSION_TOKEN`、不 prepend bin dir;`STOA_CTL_BASE_URL` 保留(诊断用) | `src/core/session-command-env.ts` |
| HTTP 路由 | 路由保留,在 `/ctl` 鉴权**之前**加 disabled gate,返回 503 disabled envelope(无凭据也返回 503) | `src/core/session-control-server.ts` |

## 数据契约

### `AppSettings` 扩展 (`src/shared/project-session.ts`)

```ts
export interface AppSettings {
  // ... existing fields ...
  stoaCtlEnabled: boolean  // NEW
}

export const DEFAULT_SETTINGS: AppSettings = {
  // ...
  stoaCtlEnabled: false    // NEW
}
```

### 持久化兼容

- `isValidPersistedState` / `isValidGlobalState` **不**校验 `stoaCtlEnabled` 字段(缺字段合法)
- 启动时若 settings 中没有该字段,运行时填入 `DEFAULT_SETTINGS.stoaCtlEnabled = false`
- 不做 `v2 → v3` / `v4 → v5` 迁移函数(原型阶段无兼容代码,符合 CLAUDE.md)

### 关闭 envelope

`/ctl/*` 在关闭时返回:

```json
{
  "ok": false,
  "data": null,
  "error": { "code": "disabled", "message": "stoa-ctl is disabled in settings", "details": {} }
}
```

HTTP 状态码 `503`,`Content-Type: application/json`。`stoa-ctl` CLI 的 `mapFailureExitCode` 已有未识别 code → 7 的回退,所以现有 client 不会崩。

`details` 字段与 `session-control-server.ts` 现有 envelope 形状一致(其他错误如 `invalid_secret` 也带 `details: {}`)。

## 错误处理与边界

| 场景 | 行为 |
|------|------|
| `state.json` 损坏 | 沿用 `state-store` 现有 `StateReadError` 恢复路径,落回 `DEFAULT_SETTINGS`(默认 false) |
| `unlink` shim 时文件不存在 | 静默忽略,不抛错 |
| 撤销 PowerShell User PATH 失败 | `console.warn` 但不阻断其他清理 |
| 撤销 shell rc 注入行失败 | 同上,设置 UI 显示"部分清理失败" |
| 子进程已启动且带 `STOA_CTL_COMMAND`,运行中切换为关闭 | 不向运行中进程补发;新 session 不再注入;运行中 session 用旧 env 继续到自然退出(toggle on/off 都不重启运行中 session) |
| HTTP 客户端在关闭瞬间请求 | 收到 503,客户端可重试或降级 |
| Windows UAC 触发 `registerPath` 失败 | 沿用现有 `console.warn` |
| 设置 toggle 切换时主进程重启中 | state.json 持久化,下次启动读取;运行时通过 `enabledChanged` 事件实时同步 |
| toggle on 时已存在运行中 session | 运行中 session 不重 spawn;`command -v stoa-ctl` 在该 session 内仍然返回旧 PATH;新建 session 才看得到新 shim |

## 测试与质量门

### 单元测试 (`src/core/stoa-ctl-feature.test.ts`)

- `isEnabled` 初始值正确
- `setEnabled(true/false)` 切换并广播 `enabledChanged`
- 关闭时 `ensureStoaCtlShim` 不创建文件,残留被 `unlink`
- 关闭时 `unregisterPath` 从 PowerShell User PATH 中移除 `~/.stoa/bin`
- `buildSessionCommandEnv` 在 `gate.isEnabled() === false` 时不含 `STOA_CTL_COMMAND` 字段
- HTTP handler 在 disabled 时返回 503 + disabled envelope

### 集成/E2E 测试 (`tests/e2e/settings-stoactl-toggle.test.ts`)

1. 全新启动 → `command -v stoa-ctl` 失败
2. 开启设置 → 重启 → `command -v stoa-ctl` 成功
3. 关闭设置 → 重启 → 残留 shim 被删除 → `command -v stoa-ctl` 失败
4. 子 session 的 env 不含 `STOA_CTL_COMMAND`
5. HTTP 关闭时返回 503 disabled envelope
6. 开启后子 session 可正常通过 `stoa-ctl session list` 调用

### 行为资产 (`testing/behavior/stoactl-lifecycle.json`)

新增节点:
- `disabled-at-startup` (默认状态)
- `enable-then-restart` (开启需重启生效)
- `disable-cleanup` (关闭时清理残留)
- `http-503-when-disabled` (HTTP 关闭语义)
- `env-stripped-when-disabled` (子会话 env 剥离)

### 拓扑资产 (`testing/topology/`)

新增 `settings-stoactl-toggle` 节点,稳定 `data-testid="settings-stoactl-toggle"`,绑定 Settings drawer 中的开关。

### 旅程资产 (`testing/journeys/stoactl-lifecycle.journey.ts`)

映射上述行为到 Playwright 可执行路径(开启→重启→`command -v` 成功;关闭→重启→清理→失败)。

### 质量门命令

按 CLAUDE.md 当前测试工作流:

```bash
npm run test:generate
npx vitest run
npm run test:e2e
npm run test:behavior-coverage
```

## 文件变更清单

| 文件 | 变更 |
|------|------|
| `src/shared/project-session.ts` | `AppSettings` 加 `stoaCtlEnabled: boolean`,`DEFAULT_SETTINGS` 默认 false |
| `src/core/stoa-ctl-feature.ts` | **新增** — `createStoaCtlGate` + `isStoaCtlEnabled` |
| `src/core/stoa-ctl-feature.test.ts` | **新增** |
| `src/core/stoa-ctl-shim.ts` | 新增 `unregisterStoaCtlShim`、`unregisterStoaCtlSystemShim`(幂等清理) |
| `src/core/stoa-ctl-shim.test.ts` | 新增 unregister 分支测试 |
| `src/core/meta-session-command-env.ts` | 接受 `stoaCtlEnabled` 选项,关闭时不输出 `STOA_CTL_COMMAND` |
| `src/core/meta-session-command-env.test.ts` | 新增 disabled 分支 |
| `src/main/index.ts` | 启动时创建 `stoaCtlGate`、订阅 `settings:updated`、4 个调用点过 gate、控制平面 handler 头查 gate |
| `src/renderer/stores/settings.ts` | 新增 `stoaCtlEnabled` reactive 字段、toggle action |
| `src/renderer/components/Settings*.vue` | 新增 toggle 控件 + 文案 + 警告对话框 |
| `src/renderer/components/Settings*.test.ts` | toggle 行为测试 |
| `testing/behavior/stoactl-lifecycle.json` | **新增** |
| `testing/topology/...` | **新增** settings-stoactl-toggle 节点 |
| `testing/journeys/stoactl-lifecycle.journey.ts` | **新增** |
| `tests/e2e/settings-stoactl-toggle.test.ts` | **新增** |

## 风险与权衡

- **破坏性升级**: 升级用户首次启动后,`stoa-ctl` 不可用,需手动开启。符合 CLAUDE.md "原型阶段无兼容代码" 原则。
- **运行中 session**: 关闭后已运行 session 仍持有旧 `STOA_CTL_COMMAND`,至自然退出。不主动 kill,避免数据丢失。
- **设置持久化位置**: 沿用 `AppSettings` 而非独立 `~/.stoa/stoactl.json`,保持单一设置通道,降低维护成本。

## 后续工作(不在本次范围)

- 关闭时主动 kill 持有 stoa-ctl 句柄的运行中 session(未来需求)
- `stoa-ctl` 命令细粒度 ACL(health/whoami 与 session.* 分别开关)
