# stoa-ctl `send-keys` 设计

日期：2026-05-11

## 背景

当前 `stoa-ctl` 只能通过：

- `work-sessions context ...` 读取上下文
- `work-sessions prompt ...` 向目标 session 注入 freeform prompt

这不足以覆盖 provider TUI 的低层交互场景，例如：

- 向等待中的 agent session 发送 `Enter`
- 发送 `Ctrl-C` 中断当前 turn
- 发送方向键在 TUI 中移动焦点
- 发送数字键 `1` / `2` 选择 provider 原生菜单或审批项

`prompt` 路径是自然语言级注入，并且默认走 proposal / approval gate；它不适合表达低层终端按键。

社区惯例也不是“远程模拟浏览器 `KeyboardEvent`”，而是 tmux 一类工具使用 `send-keys` 语义，把命名按键解析为终端控制序列，把无法识别的 token 当作字面字符发送。

## 目标

- 为 `stoa-ctl` 新增 tmux 风格命令：`work-sessions send-keys <sessionId> [key ...]`
- 支持普通字符 token 自动按字面输入，例如 `1`、`hello`
- 支持一组常用命名按键，例如 `Enter`、`C-c`、方向键
- 复用现有 `sessionInput -> SessionInputRouter -> PtyHost.write()` 链路
- 不在 renderer / preload / provider adapter 中引入额外兼容层

## 非目标

- 不实现完整 tmux `send-keys` flag 集
- 不实现浏览器 / DOM 风格按键事件对象
- 不修改现有 `prompt` proposal / approval contract
- 不为旧命令做兼容迁移

## 设计决策

### 1. CLI 语义对齐 tmux `send-keys`

新增命令：

```bash
stoa-ctl work-sessions send-keys <sessionId> [key ...]
stoa-ctl work-sessions send-keys <sessionId> --literal [text ...]
```

v1 语义：

- 默认模式下，每个参数先尝试按“键名”解析
- 若是已知键名，则转换为终端输入序列
- 若不是已知键名，则按字面字符发送
- `--literal` 禁用键名解析，所有剩余参数都按字面字符发送
- 参数之间不自动插入空格；连续参数的结果直接拼接

这和 tmux 的核心使用习惯一致：

- `send-keys hello Enter` -> `hello` + `Enter`
- `send-keys 1 Enter` -> `1` + `Enter`
- `send-keys --literal Enter` -> 字面输入 `Enter`

### 2. 解析边界放在 `stoa-ctl`

控制面新增 `POST /ctl/work-sessions/:sessionId/send-keys`，但它不再重新解析 tmux 风格 token；`stoa-ctl` 负责把命令行参数解析成最终要写入 PTY 的字符串。

这样做的原因：

- CLI 负责承接“社区熟悉语法”
- 控制面只接收明确的低层输入 payload，保持 contract 简单
- 后续若存在其他控制客户端，也可以直接提交已解析的输入数据

控制面请求体：

```json
{
  "data": "\r"
}
```

### 3. 直接复用现有 session 输入链路

数据流：

```text
stoa-ctl work-sessions send-keys
  -> tmux-style token parser
  -> POST /ctl/work-sessions/:id/send-keys { data }
  -> MetaSessionCommandDispatcher.sendKeysToWorkSession()
  -> SessionInputRouter.send(sessionId, data)
  -> PtyHost.write(sessionId, data)
```

这保证：

- shell / codex / claude-code / opencode 统一走既有输入链路
- `Ctrl-C` 仍会复用 `SessionInputRouter` 里已有的 interrupt 逻辑
- 不在 control plane 旁路 runtime 状态模型

### 4. v1 支持的键名集合

首版支持一组高频 tmux 风格键名：

- `Enter`
- `Tab`
- `Space`
- `Escape` / `Esc`
- `Backspace` / `BSpace`
- `Delete` / `DC`
- `Up`
- `Down`
- `Left`
- `Right`
- `Home`
- `End`
- `PageUp` / `PPage`
- `PageDown` / `NPage`
- `Insert` / `IC`
- `BTab`
- `C-<printable>`，例如 `C-c`、`C-m`、`C-[`
- `M-<token>`，用 `ESC` 前缀包装已支持的基础 token

超出这组集合时：

- 如果 token 不是已知键名，按字面字符发送
- 不报错，不猜测更复杂的终端私有序列

### 5. `send-keys` 明确视为低层操作员通道

`prompt` 继续保留“freeform prompt 默认 proposal + approval”。

`send-keys` 是一个显式的低层终端控制命令，语义不同：

- 它主要服务于 TUI 导航、确认、取消、恢复、审批选择
- 它不伪装成高层自然语言 prompt
- 它的风险由显式命令名、工作会话 id、控制面鉴权和操作日志语义承担

这是一个刻意的产品边界：

- 高层自然语言注入：`prompt`
- 低层终端按键注入：`send-keys`

## 测试策略

### CLI / parser

新增测试覆盖：

- usage text 暴露 `send-keys`
- 普通 token 如 `1` 按字面拼接
- 命名键 `Enter` / `C-c` / `Up` 映射为正确序列
- `--literal` 禁用键名解析
- 未识别 token 保持字面输入

### 控制面

新增测试覆盖：

- `POST /ctl/work-sessions/:id/send-keys` 成功分发
- capabilities 返回 `workSessionSendKeys: true`
- 未知 session / 非法 body 走既有错误语义

### dispatcher

新增测试覆盖：

- `sendKeysToWorkSession()` 在 session 存在时直接调用 `sessionInput.send()`
- 未知 session 抛出 `unknown_session`

## 成功标准

- `stoa-ctl work-sessions send-keys session_1 1 Enter` 能把 `1\r` 写入目标 session
- `stoa-ctl work-sessions send-keys session_1 C-c` 能复用现有 interrupt 语义
- `stoa-ctl work-sessions send-keys session_1 --literal Enter` 会输入字面文本 `Enter`
- 现有 `prompt` proposal / approval 流程不回归
