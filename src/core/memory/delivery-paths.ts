import { join } from 'node:path'
import type { Consumer } from '@shared/memory-runtime'

export function getConsumerContextPath(
  projectRoot: string,
  consumer: Extract<Consumer, 'claude-code' | 'codex'>
): string {
  return join(projectRoot, '.stoa', 'generated', 'evolver-context', `${consumer}.jsonl`)
}
