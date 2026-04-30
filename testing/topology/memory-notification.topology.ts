import { defineTopology } from '../contracts/testing-contracts'

export const memoryNotificationTopology = defineTopology({
  surface: 'memory-notification',
  testIds: {
    root: 'memory-toast-host',
    toast: 'memory-toast'
  }
})
