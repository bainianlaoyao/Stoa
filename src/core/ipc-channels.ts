export const IPC_CHANNELS = {
  projectBootstrap: 'project:bootstrap',
  projectCreate: 'project:create',
  projectSetActive: 'project:set-active',
  sessionCreate: 'session:create',
  sessionSetActive: 'session:set-active',
  sessionInput: 'session:input',
  sessionResize: 'session:resize',
  sessionArchive: 'session:archive',
  sessionRestore: 'session:restore',
  sessionListArchived: 'session:list-archived',
  sessionEvent: 'session:event',
  terminalData: 'terminal:data',
} as const
