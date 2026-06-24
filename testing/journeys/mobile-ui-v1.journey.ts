import { defineJourney } from '../contracts/testing-contracts'

export const mobileUiV1Journey = defineJourney({
  id: 'journey.mobile.ui-v1',
  behavior: 'mobile.drilldown',
  usageMode: 'phone_pickup',
  setup: ['viewport.mobile390x844', 'project.withSession', 'backend.health.connected'],
  act: [
    'open.mobile.workspaceHome',
    'tap.mobile.workspaceRow',
    'tap.mobile.sessionRow',
    'tap.mobile.keysHandle',
    'open.mobile.sessionMore'
  ],
  assert: [
    'mobile.workspaceHomeVisibleAtStartup',
    'mobile.sessionListVisibleAfterWorkspaceTap',
    'mobile.sessionViewVisibleAfterSessionTap',
    'terminal.xtermVisible',
    'mobile.landscapeKeepsMobileShell',
    'mobile.keysRailOverlayNoResize',
    'mobile.wideTerminalOnlyModeForCodingSession',
    'desktop.quickActionsAbsent',
    'desktop.rightSidebarAbsent'
  ],
  variants: ['390x844', '360x800', '844x390']
})

export const mobileSearchJourney = defineJourney({
  id: 'journey.mobile.search',
  behavior: 'mobile.search',
  usageMode: 'phone_pickup',
  setup: ['viewport.mobile390x844', 'project.withSession', 'mobile.workspaceHomeVisible'],
  act: ['tap.mobile.globalSearch', 'type.mobile.searchQuery', 'tap.mobile.sessionResult'],
  assert: ['mobile.searchLayerVisible', 'mobile.sessionResultOpensSessionView', 'mobile.searchLightDismisses'],
  variants: ['session-result', 'workspace-result', 'recent-empty-query']
})

export const mobileSessionCreationJourney = defineJourney({
  id: 'journey.mobile.session.create',
  behavior: 'mobile.session.create',
  usageMode: 'phone_pickup',
  setup: ['viewport.mobile390x844', 'workspace.selected'],
  act: ['tap.mobile.newSession', 'tap.mobile.sessionTypeIcon'],
  assert: ['mobile.typeGridUsesDesktopProviders', 'session.createPayload.titleEmpty', 'mobile.createdSessionAutoOpens'],
  variants: ['shell', 'codex', 'opencode', 'claude-code']
})

export const mobileTerminalControlsJourney = defineJourney({
  id: 'journey.mobile.terminal.controls',
  behavior: 'mobile.terminal.controls',
  usageMode: 'phone_pickup',
  setup: ['viewport.mobile390x844', 'session.open', 'backend.health.connected'],
  act: ['tap.mobile.keysHandle', 'tap.mobile.keySlash', 'tap.mobile.sessionMore'],
  assert: [
    'mobile.keysRailOverlayNoResize',
    'mobile.keysOrderEscTabUpDownSlashDashCopyPasteEnter',
    'mobile.wideTerminalOnlyModeForCodingSession',
    'mobile.displayModesAbsent'
  ],
  variants: ['portrait-horizontal-scroll', 'landscape-wide-terminal']
})

export const mobileHealthJourney = defineJourney({
  id: 'journey.mobile.health',
  behavior: 'mobile.health',
  usageMode: 'phone_pickup',
  setup: ['viewport.mobile390x844', 'backend.healthApi.available', 'session.open'],
  act: ['poll.mobile.healthFailure', 'tap.mobile.healthRetry'],
  assert: ['mobile.reconnectingBannerVisible', 'mobile.retryCallsHealthOnly', 'xterm.inputFrozen'],
  variants: ['reconnecting', 'offline', 'visibility-restored']
})
