import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { EvolverPublishedContext } from '@shared/direct-memory'

export interface DeliveredContext {
  filePath: string
  hash: string
}

function contentToText(context: EvolverPublishedContext): string {
  if (context.format === 'json') {
    return typeof context.content === 'string'
      ? context.content
      : JSON.stringify(context.content, null, 2)
  }

  if (typeof context.content !== 'string') {
    return JSON.stringify(context.content, null, 2)
  }

  return context.content
}

function targetFileName(context: EvolverPublishedContext): string {
  if (context.target === 'generic' || context.format === 'json') {
    return `${context.target}.json`
  }

  return `${context.target}.md`
}

export async function writePublishedContext(repoRoot: string, context: EvolverPublishedContext): Promise<DeliveredContext> {
  if (!context.ok) {
    throw new Error(`Cannot deliver failed published context: ${context.error ?? 'unknown error'}`)
  }

  const text = contentToText(context)
  const filePath = join(repoRoot, '.stoa', 'generated', 'evolver-context', targetFileName(context))
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, text, 'utf-8')

  return {
    filePath,
    hash: `sha256:${createHash('sha256').update(text).digest('hex')}`
  }
}
