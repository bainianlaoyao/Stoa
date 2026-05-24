# X Promotion Asset Upgrade 设计

日期：2026-05-18

## 背景

`2026-05-17-x-promotion-full-pipeline-design.md` 已经把宣传工作流推进到“素材工厂 + 周计划 + 当天发帖编排”的第二阶段，但当前素材层仍然偏薄：

- 现有 manifest 只有少量 README 图和 2 张基础 live 截图
- 能证明“这是个产品”，但还不能充分证明“这个产品具体怎么工作”
- 很难稳定组成一条像样的 X 发帖素材包

用户已经明确要求继续升级素材层，并且要求整套流程保持：

- 尽量自动
- 依赖大模型判断，而不是重规则系统
- 帖子有人味，不像硬广告
- 宣传目标是让更多 AI CLI / agent 用户知道 Stoa 和 GitHub stars
- 项目是开源、非商业、Apache-2.0

## 目标

- 把 promo 素材从“几张静态截图”升级成一套可复用的原子素材库
- 让系统每次运行都能自动生成更多真实产品行为素材，而不仅是 README 搬运
- 让素材可以直接服务三种分发形态：
  - X 单图 / 四图轮播
  - X 单个 GIF / 单个短视频
  - GitHub / 外链社交预览图
- 为每个素材自动附带简短事实说明和可直接复用的 alt 草稿
- 继续保持模型主导，程序只做场景采集、清单整理、成品重组

## 非目标

- 不做大而全的视频剪辑系统
- 不做复杂品牌海报工作台
- 不做模板引擎式运营后台
- 不做自动伪造演示内容
- 不为宣传目的引入与真实产品不一致的交互素材

## 外部依据与推荐

当前推荐方案基于以下公开约束与惯例：

- X 官方帮助与开发文档支持帖子挂多图，也支持单个 GIF / 单个视频，因此素材系统不应只产出单张截图，而应直接面向“轮播包”和“过程型动图”设计。
- X 官方支持为图片提供 alt 文本，因此素材系统应把图像说明当成一等产物，而不是后补。
- GitHub 官方文档对社交预览图给出明确尺寸建议，说明外链预览图本身就是传播资产，不能只依赖 UI 截图自然裁切。
- 开源产品在社区传播中最有效的素材通常不是纯海报，而是“真实 workflow 演示 + 可验证事实 + 少量视觉包装”的组合。对 Stoa 这类工具产品尤其如此。

基于这些约束，推荐采用：

**自动截图矩阵为主，少量 GIF / MP4 与社媒封面为辅**

而不是“继续只补几张截图”或“直接重押视频系统”。

原因：

- 比纯截图更适合 X 的传播形态
- 比完整视频系统更稳定、更容易自动化
- 能直接复用现有 Playwright / Electron 测试能力
- 更符合当前原型阶段“先做真功能证明，再做包装”的策略

## 推荐方案

将现有 promo 素材工厂升级为两段式管线：

1. **场景采集层**
   - 自动运行一组稳定的 Electron / Playwright 采集场景
   - 产出更丰富的真实产品截图、局部特写、必要时的短录屏原片
2. **成品重组层**
   - 根据原子素材自动整理出发帖可用的成品包
   - 包括四图轮播包、单图 highlight、OG 社媒封面、短 GIF / MP4

程序不负责“决定怎么写爆款文案”，只负责把素材准备到足够让 LLM 发挥的程度。

## 素材分层

素材库分为五层。

### 1. Overview 素材

作用：让用户一眼理解 Stoa 是什么。

需要自动产出：

- app shell 总览
- workspace hierarchy 总览
- 多 session 并存视图
- 多 provider 并存视图
- settings surface 总览

这些图主要服务：

- 第一次介绍产品的帖子
- GitHub 链接配图
- “what is this” 型回复草稿引用

### 2. Workflow State 素材

作用：证明产品不是静态壳，而是真的能承载工作流。

需要自动产出：

- 新建 session 前后的状态变化
- session running / ready / complete 等状态标签变化
- 同一项目下切换不同 session 的存在感
- archive 后进入 archive surface
- restore 后回到 command surface 的恢复结果

这里强调的是“状态时间轴”，不是单一截图。

### 3. Feature Closeup 素材

作用：把可单独发帖的小卖点切成原子物料。

优先覆盖这些真实存在且可验证的功能点：

- 快速新建 session 的 provider floating card
- 长按触发的 provider radial menu
- session 行状态点与状态标签
- session 右键菜单中的 restart 操作
- archive surface 的 restore 操作
- terminal meta bar / active session 信息面
- meta session 列表与 action panel
- meta session 创建入口与 provider 选择

这里特别约束：

- **只采真实产品已经存在的交互**
- 不把“restore 的右键菜单”写入素材体系，因为当前代码里可验证的 restore 入口在 archive surface，而不是 session 右键菜单

### 4. Trust Proof 素材

作用：用证据而不是广告语建立可信度。

需要自动或半自动产出：

- Apache-2.0 / 开源属性卡片
- 仓库 stars / commit / release 节奏摘要卡片
- test / behavior coverage / e2e 通过状态摘要卡片
- README / docs 中可直接复用的可信度图

这些素材可以不是 Electron 截图，也可以由程序基于 repo facts 自动生成轻量图卡。

### 5. Distribution Pack 素材

作用：把前四层原子素材重组成可直接发的内容包。

至少产出三种成品：

- `carousel`
  - 4 张图的一组轮播包
- `highlight`
  - 1 张单图重点图
- `social-preview`
  - 适合 GitHub / 外链预览的横图

后续可选扩展：

- `motion`
  - 1 个短 GIF 或 MP4，优先选择最有过程感的场景

## 场景采集矩阵

推荐把自动采集的截图场景扩到 15 到 20 个左右，但第一轮实现只需要优先落 10 到 12 个高价值场景。

### 第一批必须有的场景

1. app shell 总览
2. settings surface 总览
3. workspace hierarchy 含多个项目
4. 单项目下多个 session 并存
5. 多 provider session 并存
6. quick add session 的 provider floating card
7. long press 的 provider radial menu
8. session status running / ready / complete 的特写
9. session context menu 的 restart 入口
10. archive surface + restore 按钮
11. restore 后 session 重新回到活动区域
12. meta session surface 总览

### 第二批可选场景

13. terminal meta bar 特写
14. session isolation 对比图
15. 终端有真实输出时的 viewport
16. meta session session list + action panel
17. meta session create flow
18. memory toast / recall 类辅助反馈

第一轮实现不要求所有场景都拥有完整自动化录屏，只要求截图稳定。

## 动图与短视频策略

动图 / MP4 只做最值钱的过程型场景，不做完整视频生产线。

优先顺序：

1. 新建 session 流程
2. archive -> restore 流程
3. 切换到 meta session 并创建 meta session

实现建议：

- 先用 Playwright 连续截图 / 短录屏生成原片
- 再由本地脚本转换为 GIF 或 MP4
- 如果本轮录屏不稳定，可以先只保留截图链路，动图输出作为软失败项

## 产物结构

在现有 `automation/promo/assets/generated/` 下扩展更清晰的结构：

```text
automation/promo/assets/generated/
  live/
    overview/
    workflow/
    closeups/
    meta/
  trust/
  packs/
    carousel/
    highlight/
    social-preview/
    motion/
```

每个素材都应继续保留 sidecar 文本，但 sidecar 从单一 note 扩展为最少包含：

- `note`
- `alt`
- `category`
- `scene`
- `tags`

不需要复杂 schema 文件；可以是简洁 markdown frontmatter，也可以直接升级 manifest schema。

## Manifest 升级

`asset-manifest.json` 从“文件列表”升级为“素材索引”。

每个素材条目至少新增：

- `category`
- `scene`
- `kind`
  - `screenshot` | `gif` | `video` | `social-preview` | `fact-card`
- `tags`
- `alt`
- `source`
  - `readme-sync` | `electron-capture` | `fact-card-generator` | `derived-pack`
- `derivesFrom`
  - 记录成品包由哪些原子素材组合而来

这样后续 LLM 可以更可靠地按主题选材，而不是只按文件名猜。

## 实现边界

### 自动化应做的事

- 启动本地构建后的 Electron 应用
- 自动创建演示项目 / 演示 session
- 自动进入指定 surface
- 自动截图和必要的局部截图
- 自动聚合 repo facts 生成轻量可信度图卡
- 自动重组素材包并更新 manifest

### 自动化不应做的事

- 伪造不存在的 UI
- 用图片编辑篡改状态证明
- 引入复杂运营判断逻辑
- 为了采集素材而改动产品真实交互

## 失败与退化策略

- 某个场景截图失败，不阻断整个 `build-assets`
- 录屏 / GIF 转换失败，只跳过 motion 类成品
- 如果 Electron build 不存在，继续同步 README 图和 trust 图卡
- 如果某些复杂场景不稳定，允许通过分批启用的场景注册表逐步扩大覆盖

## 测试策略

新增或扩展测试覆盖：

- 场景注册表到输出路径的映射
- asset manifest 新 schema
- sidecar alt / tags / category 写入
- 成品 pack 的派生产物生成
- `build-assets` 在部分场景失败时仍能返回有效资产列表
- fact-pack 能正确读取升级后的素材索引

真实 Electron 场景采集继续通过依赖注入做假实现，不把录屏 / 截图真实执行塞进单元测试。

## 成功标准

满足以下条件即可视为这一轮素材升级完成：

- `promo build-assets` 产出的原子素材数量显著高于当前版本，至少覆盖第一批核心场景
- manifest 能表达素材类别、场景、alt、来源和派生关系
- 能自动产出至少一种四图轮播包和一种社交预览图
- 如果环境允许，能额外产出至少一个短动图或 MP4
- 周计划器和日运行器可以消费升级后的素材索引而无需手工干预
- 整个仓库测试门禁全部通过
