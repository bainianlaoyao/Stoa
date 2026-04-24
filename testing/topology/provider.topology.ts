import { defineTopology } from '../contracts/testing-contracts'

export const providerTopology = defineTopology({
  surface: 'provider-selection',
  testIds: {
    floatingCard: 'provider-card',
    floatingCardItem: 'provider-card.item',
    radialMenu: 'provider-radial',
    radialMenuItem: 'provider-radial.item'
  }
})
