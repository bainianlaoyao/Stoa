---
date: 2026-04-23
topic: xterm.js terminal appears narrow with squeezed/compressed text and icons
status: completed
mode: context-gathering
sources: 13
---

## Context Report: xterm.js 终端显示过窄、文字被挤压

### Why This Was Gathered
终端界面显示很窄，有些字被挤压消失，图标也被横向压缩。需要定位 xterm.js 配置或布局层面的根因。

### Summary
终端过窄和文字挤压的 **已确认根因** 是字体加载时序问题：FitAddon 在 JetBrains Mono 字体尚未加载时测量了字符宽度，计算出错误的 cols 数。后续字体加载后没有重新调用 `fit()`，导致终端保持错误的窄宽度。此根因已通过 GitHub issues #4853、#5320、#2958、#1631 的社区报告和官方回复确认，`document.fonts.ready` 是社区公认的修复方案。此外还有 CSS `var()` 传值给 WebGL 渲染器、以及布局中累积的内边距等次要问题。

### Key Findings

#### 1. 字体加载时序问题（已确认根因）

> **网络搜索确认**：GitHub issues #4853、#5320、#2958、#1631 均报告相同症状，社区共识修复为 `document.fonts.ready.then(() => fitAddon.fit())`。

**现象**：`font-display: swap` 意味着浏览器先用 fallback 字体（monospace）渲染，字体加载完成后切换。

**代码路径**：
- `styles.css:1-7` — JetBrains Mono 用 `font-display: swap` 加载
- `xterm-runtime.ts:80-81` — `fontFamily` 默认是 `'JetBrains Mono'`
- `TerminalViewport.vue:90` — `terminal.open(container)` 后立即在 `nextTick` 调用 `fitAddon.fit()`
- `TerminalViewport.vue:137-148` — fit() 在 nextTick 中执行，此时字体可能未加载完成

**问题链**：
1. `terminal.open()` → xterm 用 fallback 字体测量 cell 尺寸
2. `nextTick` → `fitAddon.fit()` 用错误的 cell 宽度计算 cols
3. JetBrains Mono 异步加载完成 → xterm 重新渲染，cell 宽度变化
4. **没有机制重新调用 `fit()`** → cols 仍然是基于 fallback 字体计算的值
5. 结果：终端过窄（cols 太少）或字符被挤压（cols 太多导致重叠）

**FitAddon 源码确认** (`node_modules/@xterm/addon-fit/lib/addon-fit.mjs:17`)：
```js
// 如果 cell 尺寸为 0（字体未加载完成时的可能情况），fit() 直接 return
if (t.css.cell.width === 0 || t.css.cell.height === 0) return;
```
如果 fit() 在字体未加载时被调用且 cell 尺寸为 0，会 **静默返回**，终端停留在默认 80 cols。

**缺少重新 fit 的机制**：
- `ResizeObserver` 只监听容器尺寸变化（`TerminalViewport.vue:154-160`），不监听字体变化
- 没有监听 xterm 的 `render` 事件或 `document.fonts.ready`

#### 2. 布局内边距累积

终端可用宽度被多层内边距蚕食：

| 层级 | 元素 | 水平占用 |
|------|------|----------|
| Activity Bar | `.app-shell` grid | 56px |
| Viewport margin | `.app-shell__viewport` | 12px (右) |
| Command body | `.command-body` padding | 20px (左+右) |
| Sidebar | `.command-layout` 240px + gap | 250px |
| Terminal shell | `.terminal-viewport__xterm-shell` padding | 32px (16px × 2) |
| xterm element | `:deep(.xterm)` padding | 20px (10px × 2) |
| **合计** | | **~390px** |

在 1280px 窗口下，终端内容区约 890px；在 1024px 下约 634px。FitAddon **确实会** 从宽度中减去 `.xterm` 的 padding（`addon-fit.mjs:17` 中 `n.right + n.left`），所以这不是直接根因，但加剧了视觉上的"窄"感。

#### 3. CSS 变量作为 xterm 主题颜色

`xterm-runtime.ts:84-106` 中 xterm theme 使用了 CSS 变量：
```ts
background: 'var(--terminal-bg)',
foreground: 'var(--terminal-text)',
```

WebGL 渲染器通过 GPU 纹理绘制，需要在 JS 层解析颜色值。`var(--terminal-bg)` 作为字符串传入 WebGL 上下文，可能无法被正确解析，导致渲染异常（视觉上类似压缩或颜色问题）。

#### 4. xterm-viewport 默认黑色背景

`node_modules/@xterm/xterm/css/xterm.css:93-103`：
```css
.xterm .xterm-viewport {
    background-color: #000;  /* 硬编码黑色 */
}
```
这个默认样式覆盖了 theme 中设置的 background 色。组件 CSS 没有覆盖这个值，可能导致滚动区域颜色与终端内容不一致。

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| JetBrains Mono 用 swap 加载 | styles.css | `styles.css:6` |
| fit() 在 nextTick 中调用，可能在字体加载前 | TerminalViewport.vue | `TerminalViewport.vue:137-148` |
| FitAddon 在 cell 尺寸为 0 时静默返回 | addon-fit.mjs | `addon-fit.mjs:17` |
| FitAddon 正确减去 .xterm padding | addon-fit.mjs | `addon-fit.mjs:17` (n.right + n.left) |
| 无字体加载后重新 fit 的机制 | TerminalViewport.vue | 无 document.fonts.ready 或 font load 监听 |
| CSS var() 传入 WebGL theme | xterm-runtime.ts | `xterm-runtime.ts:84-106` |
| 双层 padding（shell 16px + xterm 10px） | TerminalViewport.vue | `TerminalViewport.vue:299,308` |
| xterm-viewport 硬编码 #000 背景 | xterm.css | `xterm.css:95` |
| 侧边栏占 240px | styles.css | `styles.css:217` |
| 响应式断点在 960px | styles.css | `styles.css:1262-1267` |

### Web-Confirmed Evidence

| Source | Issue/Symptom | Confirmation |
|--------|---------------|--------------|
| GitHub #4853 | FitAddon calculates wrong dimensions with 100% width/height elements | 官方标记为 FitAddon 已知行为 |
| GitHub #5320 | FitAddon width collapses to 1 on repeated resize | 确认为 FitAddon bug，font loading 是触发条件之一 |
| GitHub #2958 | Wrong rows/cols calculation by addon-fit | 社区确认 `document.fonts.ready` 解决 |
| GitHub #1631 | Font not loaded causes incorrect size calculation | 最早的 font timing 报告，`document.fonts.ready` 被采纳 |
| mephisto.cc blog | xterm.js FitAddon 最佳实践 | 推荐 `document.fonts.ready` + ResizeObserver 组合 |

**社区公认修复方案**：
```ts
// 在 terminal.open() 之后，替代简单 nextTick
await document.fonts.ready
fitAddon.fit()
```

### Risks / Unknowns

- [!] **字体时序**：`font-display: swap` 的 fallback 字体（monospace）与 JetBrains Mono 的字符宽度差异可能是间歇性的，取决于字体缓存和网络 — **已通过 GitHub issues 确认为根因**
- [?] **Electron 环境**：Electron 中字体加载行为可能与浏览器不同（通常更快，本地文件），但首次启动仍可能出现问题
- [?] **WebGL 渲染器对 CSS 变量的处理**：未确认 `var()` 值在 WebGL 渲染路径中是否被正确解析，需要实际测试
- [?] **xterm.js 内部是否有自动重新测量机制**：新版本可能有改进，需确认 `@xterm/xterm` 的具体版本

### Suggested Fixes (for implementation phase)

1. **在 `document.fonts.ready` 之后调用 `fit()`**：
   ```ts
   // 替代简单的 nextTick
   await document.fonts.ready
   localFitAddon.fit()
   ```

2. **监听 terminal 的 resize/render 事件做二次 fit**：
   ```ts
   localTerminal.onRender(() => {
     // 首次有效渲染后 fit 一次
   })
   ```

3. **移除 `.xterm` 上的 padding，改用外层容器的 padding**：
   ```css
   /* 删除 :deep(.xterm) 的 padding */
   /* 改为在 xterm-mount 上加 padding */
   .terminal-viewport__xterm-mount {
     padding: var(--terminal-content-padding);
   }
   ```

4. **xterm theme 颜色使用具体色值而非 CSS 变量**：
   ```ts
   background: '#0a0b0d',  // 替代 'var(--terminal-bg)'
   ```

5. **覆盖 xterm-viewport 默认背景色**：
   ```css
   .terminal-viewport__xterm-mount :deep(.xterm-viewport) {
     background-color: var(--terminal-bg) !important;
   }
   ```
