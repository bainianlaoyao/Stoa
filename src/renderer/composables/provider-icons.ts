import type { SessionType } from '@shared/project-session'
import { SESSION_PROVIDER_ORDER } from '@shared/provider-descriptors'
import claudeCodeIcon from '@renderer/assets/providers/claude-code.svg'
import codexIcon from '@renderer/assets/providers/codex.svg'
import opencodeIcon from '@renderer/assets/providers/opencode.svg'
import shellIcon from '@renderer/assets/providers/shell.svg'

export interface ProviderIcon {
  type: SessionType
  label: string
  src: string
}

const ICONS: Record<SessionType, ProviderIcon> = {
  opencode: {
    type: 'opencode',
    label: 'OC',
    src: opencodeIcon
  },
  codex: {
    type: 'codex',
    label: 'CX',
    src: codexIcon
  },
  'claude-code': {
    type: 'claude-code',
    label: 'CC',
    src: claudeCodeIcon
  },
  shell: {
    type: 'shell',
    label: 'Shell',
    src: shellIcon
  }
}

export const PROVIDER_ICONS: ProviderIcon[] = SESSION_PROVIDER_ORDER.map(type => ICONS[type])
