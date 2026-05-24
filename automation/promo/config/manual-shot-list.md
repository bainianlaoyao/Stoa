# Manual Shot List

资产目录现在分成两层：point 和 pack。

point 是原子宣传点。每个宣传点一个文件夹，文件夹里放 1 到 n 张图片，再配一个自然语言 `index.md`。图片可以后补，但目录和文案最好先搭好。

pack 是组合层。放在 `automation/promo/packs/*.json`，只引用 point id，不复制图片。

目前已经建议好的 point 有这些：

- `overview-solution-style`
- `overview-app-shell`
- `overview-workspace-multi-session`
- `overview-provider-mix`
- `overview-settings-surface`
- `overview-update-status-surface`
- `overview-terminal-live-output`
- `workflow-new-project`
- `workflow-project-create-to-visible`
- `workflow-new-session`
- `workflow-new-session-floating-entry`
- `workflow-new-session-radial-entry`
- `workflow-session-switching`
- `workflow-session-state-lifecycle`
- `workflow-session-maintenance-menu`
- `workflow-archive-restore`
- `workflow-session-archive-to-restore`
- `workflow-restore-return`
- `workflow-project-delete`
- `workflow-project-delete-entry`
- `workflow-meta-session-archive-restore`
- `closeup-new-project-modal-filled`
- `closeup-new-project-path-picker`
- `closeup-new-project-submit-ready`
- `closeup-provider-floating-card`
- `closeup-provider-radial-menu`
- `closeup-session-context-menu-restart`
- `closeup-session-context-menu-regenerate-title`
- `closeup-session-status-running`
- `closeup-session-status-ready`
- `closeup-session-status-blocked`
- `closeup-session-status-permission-block`
- `closeup-session-status-complete`
- `closeup-session-status-failure`
- `closeup-terminal-meta-bar`
- `closeup-terminal-meta-explanation`
- `closeup-project-delete-confirm`
- `closeup-workspace-archive-action`
- `closeup-active-session-indicator`
- `meta-meta-session-overview`
- `meta-meta-session-create-flow`
- `meta-meta-session-list-and-inspector`
- `meta-meta-session-action-panel`
- `meta-meta-session-status-chip`
- `meta-meta-session-archived-list`
- `meta-meta-session-restore-action`
- `trust-apache-open-source`
- `trust-release-velocity`
- `trust-github-stars-surface`
- `trust-builder-led-shipping`
- `trust-session-lifecycle-mental-model`

当前默认 pack：

- `pack-first-impression`
- `pack-session-control`
- `pack-recovery-loop`
- `pack-meta-session`
- `pack-open-source-trust`
- `pack-workflow-proof`
- `pack-closeup-details`
- `pack-launch-story`

如果后面继续补图，优先顺序可以很简单：先补能讲清产品整体心智模型的 overview 和 workflow，再补最有人味的 closeup，最后再决定哪些 trust 证据要做成更强的对外物料。
