export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'up-to-date'
  | 'disabled'
  | 'error'

export interface UpdateState {
  phase: UpdatePhase
  currentVersion: string
  availableVersion: string | null
  downloadedVersion: string | null
  downloadProgressPercent: number | null
  lastCheckedAt: string | null
  message: string | null
  requiresSessionWarning: boolean
}
