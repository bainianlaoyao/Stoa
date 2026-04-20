# Official Product Doc Revision Draft

This draft is intended to replace or substantially rewrite the older `docs/product/workspace-console-ux.md` direction so it aligns with the latest authoritative preview-based product shape.

---

# 工作区控制台与多面板产品形态（修订稿）

## 产品定位

`ultra_simple_panel` 的当前产品形态不再是单纯的“左侧工作区列表 + 右侧终端”的二元界面，而是一个面向 AI 并发编程场景的 **层级化 operator console**。

它的职责不是替代 IDE，也不是复刻通用终端，而是为“多工作区、多会话、多 Agent、低状态丢失风险”的工作方式提供一个稳定、克制、可监督的桌面容器。

当前权威产品形态以 `preview` 中的最新 mockup 为准。

## 顶层产品结构

界面采用以下顶层结构：

1. **Command / Terminal 面板**：主执行工作面。
2. **Inbox / Queue 面板**：待人工关注、待确认、待审阅事项面板。
3. **Context Tree / Blast Radius 面板**：当前焦点工作区/会话的文件上下文与影响面板。
4. **Settings**：设置入口。

这三个主面板通过全局 activity bar 切换。任一时刻只激活一个主面板。

## 当前阶段约束

- **Command / Terminal 面板必须可用且为主工作面。**
- **Inbox / Queue 面板允许先做占位。**
- **Context Tree / Blast Radius 面板允许先做占位。**

这里的“占位”仅表示当前阶段可以不实现完整业务能力，不表示可以不纳入信息架构。两个额外面板已经是正式产品结构的一部分，必须在导航与布局中存在。

## 全局 Activity Bar

左侧全局 activity bar 负责顶层产品面板切换。

至少包含以下入口：

- Command / Terminal
- Inbox / Queue
- Context Tree / Blast Radius
- Settings

设计要求：

- 活动态清晰，但不过度依赖高饱和 accent 填充
- Queue 面板可带未处理事项 badge
- 所有入口应支持 hover、active、focus-visible 状态

## Command / Terminal 面板

这是当前阶段最重要的主工作面。

它内部采用左右双栏：

- **左侧：层级化路由/索引列**
- **右侧：主终端执行区**

### 左侧层级化路由/索引列

左侧不再是简单的扁平 workspace 卡片列表，而应升级为 **层级化结构**。

推荐结构为：

- 项目 / 工作区父节点
  - 会话 / 任务子节点

每个节点可包含以下信息：

- 名称
- 状态灯
- 最近活动时间
- 当前是否为激活态
- 父节点上的“新建子会话”入口

左侧顶部应保留“新建项目/工作区”主操作入口。

### 层级化模型说明

架构上的 canonical entity 仍然是 `workspace`。前端允许通过层级化展示将其组织为更易理解的父子结构，但不得在渲染层自发明真实状态来源或会话控制逻辑。

换言之：

- 后端仍以 `workspace` / session 等真实对象为准
- 前端可以用项目/工作区/子会话的方式组织视图
- 前端只负责映射，不拥有真实调度权

### 右侧主终端执行区

右侧由 `xterm.js` 承载，继续作为系统主工作面。

要求：

- 切换焦点工作区/会话时，终端实例不应被轻易销毁
- 应优先通过视图显隐或稳定挂载机制保证低延迟切换
- 终端仍然是人类观察执行过程的主窗口

终端区上方可展示轻量元信息，例如：

- workspace ID
- session ID
- provider 信息
- 当前状态摘要

## Inbox / Queue 面板

该面板表示所有需要人工处理、审阅或确认的事项。

典型内容包括：

- 完成但待人工确认的输出
- 错误事项
- 待 acknowledge 的任务

当前阶段允许只实现占位结构，但占位也应体现最终信息架构，例如：

- 左侧队列列表
- 右侧详情面板
- 明确的空状态 / 占位说明
- 可保留不可用或静态的确认按钮位置

## Context Tree / Blast Radius 面板

该面板表示当前焦点工作区/会话影响到的文件上下文与变更范围。

典型信息包括：

- 哪些文件被读取（READ）
- 哪些文件被修改（MOD）
- 哪些文件被新增（NEW）
- 这些文件与当前会话的关联说明

当前阶段允许只实现占位结构，但占位也应体现最终形态，例如：

- 左侧树形结构
- 右侧关联详情
- 只读/占位说明

## 状态反馈要求

以下状态必须在界面中可区分地表达：

- `bootstrapping`
- `starting`
- `running`
- `awaiting_input`
- `degraded`
- `error`
- `exited`
- `needs_confirmation`

其中至少要保证以下几类状态在视觉上明确不同：

- 运行中
- 等待输入
- 错误
- 需要人工确认
- 中性/停止

### 状态来源规则

- 状态摘要必须来自状态通道，不得从终端输出中猜测
- UI 中的状态变化必须与后端事件顺序一致
- 渲染层只做映射，不自行发明权威状态

## 交互原则

- 顶层面板切换通过 activity bar 完成
- Command 面板内的焦点切换优先通过点击层级节点完成
- 不引入 command palette 作为主要交互入口
- 不让用户在界面中直接编辑底层状态文件
- 当前阶段不设计多窗口或云同步

## 视觉语言

所有 UI 必须遵循仓库设计语言：

- Modern Minimalist Glassmorphism
- Clean UI
- 使用共享 design tokens
- 通过透明度、blur、shadow 建立层级
- 避免厚重边框和噪声化设计
- 区分 UI 字体与 Mono 字体
- 动效克制且平滑

## 当前阶段可交付标准

当前阶段的产品界面只有在以下条件全部满足时才算符合方向：

1. 顶层 activity bar 已存在，且包含三个主面板入口
2. Command / Terminal 面板已可用
3. 左侧索引已是层级化结构，而非扁平列表
4. 终端仍是主要执行面
5. Inbox / Queue 与 Context Tree / Blast Radius 已作为可进入的占位面板存在
6. 状态展示以结构化状态通道为准
7. 整体视觉语言符合 design-language.md

## 不做的事情

- 不把产品做成 IDE 式多编辑器工作台
- 不把 command palette 变成主要路由入口
- 不在前端复制后端状态机逻辑
- 不把 preview 中已确立的面板结构视为“可有可无的探索项”
