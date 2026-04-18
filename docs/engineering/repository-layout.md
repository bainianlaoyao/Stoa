# 仓库布局规范

## 当前阶段布局

当前仓库先以文档为中心，代码目录尚未初始化。其目的不是拖延实现，而是先把工程边界写死，避免脚手架先行导致架构漂移。

> 更新：该约束已经完成第一阶段落地。仓库目前同时包含文档库与最小工程骨架，代码结构已按本文定义初始化。

## 未来代码布局

```text
.
├─ docs/
├─ src/
│  ├─ main/
│  ├─ preload/
│  ├─ renderer/
│  │  ├─ app/
│  │  ├─ components/
│  │  ├─ stores/
│  │  └─ views/
│  ├─ core/
│  └─ extensions/
│     ├─ providers/
│     └─ panels/
├─ scripts/
├─ resources/
└─ package.json
```

## 布局原则

- 以责任划分目录，而不是简单按“前后端”二分。
- `core` 永远是系统能力中心。
- `extensions` 永远是白盒扩展区。
- `renderer` 永远不接管真实会话控制权。

## 文档与代码关系

后续任何代码目录新增，都应能在 `docs/architecture/` 或 `docs/engineering/` 中找到对应设计依据。如果某个代码结构无法在文档中解释，说明文档与实现已经开始偏离。
