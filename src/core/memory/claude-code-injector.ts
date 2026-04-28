import { join } from 'node:path'

export function getClaudeCodePublishedContextPath(projectPath: string): string {
  return join(projectPath, '.stoa', 'generated', 'evolver-context', 'claude-code.jsonl')
}
