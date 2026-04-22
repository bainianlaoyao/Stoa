// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ArchiveSurface from './ArchiveSurface.vue'
import type { SessionSummary } from '@shared/project-session'

const archivedSession: SessionSummary = {
  id: 'session-archived-1',
  projectId: 'project-1',
  type: 'shell',
  status: 'exited',
  title: 'Old Shell',
  summary: 'done',
  recoveryMode: 'fresh-shell',
  externalSessionId: null,
  createdAt: '2026-04-21T00:00:00.000Z',
  updatedAt: '2026-04-21T00:00:00.000Z',
  lastActivatedAt: '2026-04-21T00:00:00.000Z',
  archived: true
}

describe('ArchiveSurface', () => {
  it('renders archive surface with correct data attributes', () => {
    const wrapper = mount(ArchiveSurface, { props: { archivedSessions: [] } })
    expect(wrapper.find('[data-surface="archive"]').exists()).toBe(true)
  })

  it('shows empty message when no archived sessions', () => {
    const wrapper = mount(ArchiveSurface, { props: { archivedSessions: [] } })
    expect(wrapper.find('.archive-empty').exists()).toBe(true)
  })

  it('renders archived session cards', () => {
    const wrapper = mount(ArchiveSurface, {
      props: { archivedSessions: [archivedSession] }
    })
    expect(wrapper.find('[data-archive-session="session-archived-1"]').exists()).toBe(true)
    expect(wrapper.find('.archive-card__title').text()).toBe('Old Shell')
  })

  it('restore button emits restoreSession event', async () => {
    const wrapper = mount(ArchiveSurface, {
      props: { archivedSessions: [archivedSession] }
    })
    await wrapper.find('[data-archive-restore="session-archived-1"]').trigger('click')
    expect(wrapper.emitted('restoreSession')).toHaveLength(1)
    expect(wrapper.emitted('restoreSession')![0]).toEqual(['session-archived-1'])
  })
})
