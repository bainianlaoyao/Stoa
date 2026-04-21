import type { SessionType } from '@shared/project-session'

export interface ProviderIcon {
  type: SessionType
  label: string
  svg: string
  viewBox: string
}

export const PROVIDER_ICONS: ProviderIcon[] = [
  {
    type: 'opencode',
    label: 'OC',
    viewBox: '0 0 512 512',
    svg: '<rect width="512" height="512" fill="#131010"/>'
      + '<path d="M384 416H128V96H384V416ZM320 160H192V352H320V160Z" fill="white"/>'
      + '<path d="M320 224V352H192V224H320Z" fill="#5A5858"/>'
  },
  {
    type: 'shell',
    label: 'Shell',
    viewBox: '0 0 24 24',
    svg: '<rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>'
      + '<path d="M7 8l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<line x1="13" y1="14" x2="17" y2="14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'
  }
]
