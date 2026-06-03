import { defineJourney } from '../contracts/testing-contracts'

export const stoactlDisableCleanupJourney = defineJourney({
  id: 'stoactl.disableCleanup',
  behavior: 'stoactl.disableCleanup',
  usageMode: 'deactivation',
  setup: [
    'settings.stoaCtlEnabled=true',
    'shim.present',
    'path.binDirRegistered'
  ],
  act: [
    'settings.toggleOff stoaCtlEnabled'
  ],
  assert: [
    'shim.absent',
    'path.binDirUnregistered',
    'http.ctlReturns503'
  ],
  variants: ['cold-boot', 'runtime-toggle']
})

export const stoactlEnvStrippedJourney = defineJourney({
  id: 'stoactl.envStrippedWhenDisabled',
  behavior: 'stoactl.envStrippedWhenDisabled',
  usageMode: 'session-startup',
  setup: [
    'settings.stoaCtlEnabled=false',
    'session.spawnRequested'
  ],
  act: [
    'session.spawnWithEnv'
  ],
  assert: [
    'env.STOA_CTL_COMMAND.absent',
    'env.STOA_CTL_SESSION_TOKEN.absent',
    'env.STOA_CTL_BASE_URL.present'
  ],
  variants: ['shell', 'opencode']
})
