import type { SessionType } from '@shared/project-session'
import { SESSION_PROVIDER_ORDER } from '@shared/provider-descriptors'

export interface ProviderIcon {
  type: SessionType
  label: string
  svg: string
  viewBox: string
}

const ICONS: Record<SessionType, ProviderIcon> = {
  opencode: {
    type: 'opencode',
    label: 'OC',
    viewBox: '0 0 512 512',
    svg: '<rect width="512" height="512" fill="#131010"/>'
      + '<path d="M384 416H128V96H384V416ZM320 160H192V352H320V160Z" fill="white"/>'
      + '<path d="M320 224V352H192V224H320Z" fill="#5A5858"/>'
  },
  codex: {
    type: 'codex',
    label: 'CX',
    viewBox: '0 0 24 24',
    svg: '<path d="M12 3L19 7V17L12 21L5 17V7L12 3Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>'
      + '<path d="M9 10L7.5 12L9 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M15 10L16.5 12L15 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<line x1="10.75" y1="15.5" x2="13.25" y2="8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'
  },
  'claude-code': {
    type: 'claude-code',
    label: 'CC',
    viewBox: '0 0 24 24',
    svg: '<path d="M7 5H15.5C18 5 20 7 20 9.5C20 11.6 18.6 13.4 16.6 13.9L19 19H15.8L13.8 14.4H10.5V19H7V5Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>'
      + '<path d="M10.5 8.5H15C15.8 8.5 16.5 9.2 16.5 10C16.5 10.8 15.8 11.5 15 11.5H10.5V8.5Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>'
  },
  shell: {
    type: 'shell',
    label: 'Shell',
    viewBox: '0 0 24 24',
    svg: '<rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>'
      + '<path d="M7 8l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<line x1="13" y1="14" x2="17" y2="14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'
  }
}

export const PROVIDER_ICONS: ProviderIcon[] = SESSION_PROVIDER_ORDER.map(type => ICONS[type])
