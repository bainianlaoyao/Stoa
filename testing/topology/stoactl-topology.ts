import { defineTopology } from '../contracts/testing-contracts'

export const stoactlTopology = defineTopology({
  surface: 'stoactl-lifecycle',
  testIds: {
    settingsStoactlToggle: '[data-testid="settings-stoactl-toggle"]',
    settingsAdvancedTab: '[data-settings-tab="advanced"]'
  }
})
