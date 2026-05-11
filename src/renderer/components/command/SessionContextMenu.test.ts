// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SessionContextMenu from './SessionContextMenu.vue'

const sessionContextMenuPath = resolve(dirname(fileURLToPath(import.meta.url)), 'SessionContextMenu.vue')

describe('SessionContextMenu', () => {
  it('renders visible actions and emits select on click', async () => {
    const wrapper = mount(SessionContextMenu, {
      props: {
        visible: true,
        position: { x: 120, y: 160 },
        ariaLabel: 'Session actions',
        items: [
          { id: 'restart', label: 'Restart session' }
        ]
      }
    })

    const menu = document.querySelector('[data-testid="session-context-menu"]')
    expect(menu).not.toBeNull()
    expect(menu?.textContent).toContain('Restart session')

    const button = document.querySelector('[data-testid="session-context-menu.item.restart"]') as HTMLButtonElement | null
    expect(button).not.toBeNull()
    button!.click()

    expect(wrapper.emitted('select')).toEqual([['restart']])
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('keeps tokenized glass styling in source', () => {
    const source = readFileSync(sessionContextMenuPath, 'utf8')

    expect(source).toContain('var(--color-surface)')
    expect(source).toContain('var(--color-line)')
    expect(source).toContain('var(--shadow-glass)')
    expect(source).not.toContain('background: #')
  })
})
