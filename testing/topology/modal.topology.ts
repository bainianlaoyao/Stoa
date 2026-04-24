import { defineTopology } from '../contracts/testing-contracts'

export const modalTopology = defineTopology({
  surface: 'modal',
  testIds: {
    root: 'modal-root',
    overlay: 'modal-overlay',
    panel: 'modal-panel',
    title: 'modal-title',
    close: 'modal-close',
    body: 'modal-body',
    newProjectSubmit: 'new-project.submit',
    newProjectCancel: 'new-project.cancel'
  }
})
