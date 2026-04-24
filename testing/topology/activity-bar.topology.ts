import { defineTopology } from '../contracts/testing-contracts'

export const activityBarTopology = defineTopology({
  surface: 'activity-bar',
  testIds: {
    root: 'activity-bar',
    clusterTop: 'activity-cluster-top',
    clusterBottom: 'activity-cluster-bottom'
  }
})
