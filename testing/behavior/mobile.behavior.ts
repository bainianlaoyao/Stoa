import { defineBehavior } from '../contracts/testing-contracts'

export const mobileDrilldownBehavior = defineBehavior({
  id: 'mobile.drilldown',
  actor: 'user',
  goal: 'enter the phone UI through Workspace Home, pick a workspace, then open one full-screen xterm session',
  entities: ['mobile-shell', 'workspace', 'session', 'xterm'],
  usageModes: ['phone_pickup'],
  preconditions: ['viewport.phoneGeometry', 'workspace.exists', 'session.exists'],
  action: 'mobile.navigateWorkspaceSession',
  expects: [
    'mobile.workspaceHomeVisibleAtStartup',
    'mobile.sessionListVisibleAfterWorkspaceTap',
    'mobile.sessionViewVisibleAfterSessionTap',
    'terminal.xtermVisible',
    'mobile.landscapeKeepsMobileShell',
    'desktop.quickActionsAbsent',
    'desktop.rightSidebarAbsent'
  ],
  invalidPreconditions: ['workspace.missing', 'session.missing'],
  interruptions: ['viewport.rotates.landscape', 'session.stateChangesWhileOpen'],
  recovery: ['mobile.backReturnsToOwningSessionList', 'desktopShellUnaffectedAt1280'],
  observationLayers: ['ui', 'renderer-store'],
  risk: 'high',
  coverageBudget: 'critical'
})

export const mobileSearchBehavior = defineBehavior({
  id: 'mobile.search',
  actor: 'user',
  goal: 'find workspaces and sessions through a lightweight transient mobile search layer',
  entities: ['mobile-search', 'workspace', 'session'],
  usageModes: ['phone_pickup'],
  preconditions: ['viewport.phoneGeometry', 'workspace.exists', 'session.exists'],
  action: 'mobile.searchWorkspaceAndSession',
  expects: [
    'mobile.searchLayerVisible',
    'mobile.searchGroupsSessionsAndWorkspaces',
    'mobile.sessionResultOpensSessionView',
    'mobile.workspaceResultOpensSessionList',
    'mobile.searchLightDismisses'
  ],
  invalidPreconditions: ['query.emptyShowsRecentOnly'],
  interruptions: ['dismiss.byBackdrop', 'dismiss.byBackGesture'],
  recovery: ['returnsToOpeningSurface'],
  observationLayers: ['ui', 'renderer-store'],
  risk: 'medium',
  coverageBudget: 'high'
})

export const mobileSessionCreationBehavior = defineBehavior({
  id: 'mobile.session.create',
  actor: 'user',
  goal: 'create a session on mobile only from a workspace session list after choosing a desktop-backed session type icon',
  entities: ['workspace', 'session', 'provider-selection'],
  usageModes: ['phone_pickup'],
  preconditions: ['viewport.phoneGeometry', 'workspace.selected'],
  action: 'mobile.createSessionFromTypeGrid',
  expects: [
    'mobile.newSessionAbsentOnWorkspaceHome',
    'mobile.newSessionVisibleOnSessionList',
    'mobile.typeGridUsesDesktopProviders',
    'session.createPayload.titleEmpty',
    'mobile.createdSessionAutoOpens'
  ],
  invalidPreconditions: ['workspace.notSelected'],
  interruptions: ['sheet.dismissedBeforeSelection'],
  recovery: ['noSessionCreatedUntilTypeSelected'],
  observationLayers: ['ui', 'renderer-store', 'main-debug-state'],
  risk: 'high',
  coverageBudget: 'critical'
})

export const mobileTerminalControlsBehavior = defineBehavior({
  id: 'mobile.terminal.controls',
  actor: 'user',
  goal: 'interact with the mobile xterm through a fixed wide terminal surface and explicit right-side key rail',
  entities: ['session', 'xterm', 'key-rail', 'fixed-wide-terminal'],
  usageModes: ['phone_pickup'],
  preconditions: ['viewport.phoneGeometry', 'session.open', 'backend.health=connected'],
  action: 'mobile.terminalAuxiliaryControls',
  expects: [
    'mobile.keysHandleVisible',
    'mobile.keysRailOverlayNoResize',
    'mobile.keysOrderEscTabUpDownSlashDashCopyPasteEnter',
    'mobile.copyUsesSelection',
    'mobile.pasteReadsClipboard',
    'mobile.wideTerminalOnlyModeForCodingSession',
    'mobile.displayModesAbsent'
  ],
  invalidPreconditions: ['backend.health!=connected'],
  interruptions: ['tapOutsideKeyRail', 'viewport.rotates.landscape'],
  recovery: ['terminalRemainsMounted', 'xtermColumnsNotRecalculatedByRail'],
  observationLayers: ['ui', 'renderer-store'],
  risk: 'high',
  coverageBudget: 'critical'
})

export const mobileHealthBehavior = defineBehavior({
  id: 'mobile.health',
  actor: 'system',
  goal: 'show backend health on mobile and freeze xterm input while reconnecting or offline without mutating sessions',
  entities: ['backend-health', 'mobile-shell', 'xterm', 'session'],
  usageModes: ['phone_pickup'],
  preconditions: ['viewport.phoneGeometry', 'backend.healthApi.available'],
  action: 'mobile.pollBackendHealth',
  expects: [
    'mobile.healthDotVisible',
    'mobile.reconnectingBannerVisible',
    'mobile.offlineBannerVisible',
    'mobile.retryCallsHealthOnly',
    'xterm.inputFrozen',
    'xterm.outputAndCopyStillAvailable'
  ],
  invalidPreconditions: ['backend.healthApi.missing'],
  interruptions: ['backend.failureLongerThan15s', 'visibility.restored'],
  recovery: ['connectedRestoresInput', 'noOfflineQueue', 'sessionNotRestarted'],
  observationLayers: ['ui', 'renderer-store', 'main-debug-state'],
  risk: 'high',
  coverageBudget: 'critical'
})
