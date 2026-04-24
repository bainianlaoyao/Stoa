import { defineTopology } from '../contracts/testing-contracts'

export const terminalTopology = defineTopology({
  surface: 'terminal',
  testIds: {
    viewport: 'terminal-viewport',
    xterm: 'terminal-xterm',
    shell: 'terminal-shell',
    xtermMount: 'terminal-xterm-mount',
    overlay: 'terminal-overlay',
    emptyState: 'terminal-empty-state'
  }
})
