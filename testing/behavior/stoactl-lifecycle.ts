import { defineBehavior } from '../contracts/testing-contracts'

export const stoactlDisabledAtStartup = defineBehavior({
  id: 'stoactl.disabledAtStartup',
  actor: 'system',
  goal: 'fresh install leaves stoa-ctl invisible (no shim, no PATH, /ctl/* returns 503)',
  entities: ['settings', 'shim', 'path', 'http-control-plane'],
  usageModes: ['cold_start'],
  preconditions: ['settings.stoaCtlEnabled=false'],
  action: 'app.boot',
  expects: [
    'shim.absent',
    'path.binDirAbsent',
    'http.ctlReturns503',
    'env.stoaCtlCommandAbsent'
  ],
  invalidPreconditions: ['settings.stoaCtlEnabled=true'],
  interruptions: ['shim.residueFromOldInstall'],
  recovery: ['unregisterShimAndPath'],
  observationLayers: ['main-debug-state', 'persisted-state'],
  risk: 'medium',
  coverageBudget: 'high'
})

export const stoactlEnableThenRestart = defineBehavior({
  id: 'stoactl.enableThenRestart',
  actor: 'user',
  goal: 'toggling on in settings makes stoa-ctl available after restart',
  entities: ['settings', 'shim', 'path', 'http-control-plane'],
  usageModes: ['activation'],
  preconditions: ['settings.stoaCtlEnabled=false'],
  action: 'settings.toggleOn',
  expects: [
    'persisted.stoaCtlEnabled=true',
    'shim.presentAfterRestart',
    'path.binDirRegisteredAfterRestart',
    'http.ctlHealthReturnsOk'
  ],
  invalidPreconditions: ['persistence.failed'],
  interruptions: ['app.notRestarted'],
  recovery: ['userInitiatedRestart'],
  observationLayers: ['renderer-store', 'main-debug-state', 'persisted-state'],
  risk: 'medium',
  coverageBudget: 'high'
})

export const stoactlDisableCleanup = defineBehavior({
  id: 'stoactl.disableCleanup',
  actor: 'user',
  goal: 'toggling off removes shim, unregisters PATH, new sessions lose STOA_CTL_COMMAND',
  entities: ['settings', 'shim', 'path', 'http-control-plane', 'session-env'],
  usageModes: ['deactivation'],
  preconditions: ['settings.stoaCtlEnabled=true'],
  action: 'settings.toggleOff',
  expects: [
    'shim.removed',
    'path.binDirUnregistered',
    'http.ctlReturns503',
    'newSession.env.stoaCtlCommandAbsent'
  ],
  invalidPreconditions: ['shim.locked'],
  interruptions: [],
  recovery: ['consoleWarnOnPartialCleanup'],
  observationLayers: ['renderer-store', 'main-debug-state', 'persisted-state'],
  risk: 'medium',
  coverageBudget: 'high'
})

export const stoactlHttp503WhenDisabled = defineBehavior({
  id: 'stoactl.http503WhenDisabled',
  actor: 'system',
  goal: '/ctl/* returns 503 disabled envelope while toggle is off',
  entities: ['http-control-plane'],
  usageModes: ['diagnostics'],
  preconditions: ['settings.stoaCtlEnabled=false'],
  action: 'http.get /ctl/health',
  expects: ['http.status=503', 'envelope.error.code=disabled'],
  invalidPreconditions: [],
  interruptions: [],
  recovery: [],
  observationLayers: ['main-debug-state'],
  risk: 'low',
  coverageBudget: 'standard'
})

export const stoactlEnvStrippedWhenDisabled = defineBehavior({
  id: 'stoactl.envStrippedWhenDisabled',
  actor: 'system',
  goal: 'sub-session env does not contain STOA_CTL_COMMAND / STOA_CTL_SESSION_TOKEN when toggle is off',
  entities: ['session-env'],
  usageModes: ['session-startup'],
  preconditions: ['settings.stoaCtlEnabled=false'],
  action: 'session.spawn',
  expects: ['env.STOA_CTL_COMMAND.absent', 'env.STOA_CTL_SESSION_TOKEN.absent', 'env.STOA_CTL_BASE_URL.present'],
  invalidPreconditions: [],
  interruptions: [],
  recovery: [],
  observationLayers: ['main-debug-state'],
  risk: 'low',
  coverageBudget: 'standard'
})
