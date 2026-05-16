#!/usr/bin/env node

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appendPostHistory, appendReplyHistory } from '../../src/core/promo/history-store'
import { ensurePromoScaffold } from '../../src/core/promo/promo-paths'
import { createWebbridgeClient } from '../../src/core/promo/webbridge-client'
import { runDailyOrchestrator as defaultRunDailyOrchestratorCore } from '../../src/core/promo/daily-orchestrator'
import {
  publishPostCandidate,
  sendReplyCandidate,
  smokeCheckXCompose as defaultSmokeCheckCore
} from '../../src/core/promo/x-engagement'
import type {
  PromoPaths,
  PromoReplyQueueArtifact,
  PromoTodayPostsArtifact
} from '../../src/core/promo/types'

interface WritableLike {
  write: (chunk: string) => unknown
}

interface RunDependencies {
  repoRoot?: string
  smokeCheck?: () => Promise<unknown>
  runDailyOrchestrator?: (input: { repoRoot: string; publish: boolean }) => Promise<unknown>
  publishQueuedPosts?: (input: { repoRoot: string; mode: 'all' | 'id'; postId?: string }) => Promise<unknown>
  previewOrSendReply?: (input: { repoRoot: string; replyId: string; optionIndex: number; confirm: boolean }) => Promise<unknown>
  stdout?: WritableLike
  stderr?: WritableLike
}

export const USAGE_TEXT = [
  'Usage: promo <command>',
  '',
  'Commands:',
  '  smoke',
  '  run-daily [--publish]',
  '  publish-posts [--all|--id <postId>]',
  '  send-reply --id <replyId> --option <n> [--yes]'
].join('\n')

class CliUsageError extends Error {}

export async function run(argv: string[], deps: RunDependencies = {}): Promise<number> {
  const stdout = deps.stdout ?? process.stdout
  const stderr = deps.stderr ?? process.stderr
  const repoRoot = deps.repoRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

  try {
    const [command, ...rest] = argv
    if (!command) {
      throw new CliUsageError('Missing command')
    }

    if (command === 'smoke') {
      const smokeCheck = deps.smokeCheck ?? (async () => await defaultSmokeCheck(repoRoot))
      stdout.write(`${JSON.stringify(await smokeCheck(), null, 2)}\n`)
      return 0
    }

    if (command === 'run-daily') {
      const publish = hasFlag(rest, '--publish')
      const runDailyOrchestrator = deps.runDailyOrchestrator ?? (async (input: { repoRoot: string; publish: boolean }) => {
        return await defaultRunDaily(input.repoRoot, input.publish)
      })
      const result = await runDailyOrchestrator({ repoRoot, publish })
      stdout.write(`${JSON.stringify(result, null, 2)}\n`)
      return 0
    }

    if (command === 'publish-posts') {
      const mode = hasFlag(rest, '--all') ? 'all' : 'id'
      const postId = parseFlagValue(rest, '--id')
      if (mode === 'id' && !postId) {
        throw new CliUsageError('Missing --id or --all')
      }
      const publishQueuedPosts = deps.publishQueuedPosts ?? (async (input: { repoRoot: string; mode: 'all' | 'id'; postId?: string }) => {
        return await defaultPublishQueuedPosts(input.repoRoot, input.mode, input.postId)
      })
      stdout.write(`${JSON.stringify(await publishQueuedPosts({ repoRoot, mode, postId: postId ?? undefined }), null, 2)}\n`)
      return 0
    }

    if (command === 'send-reply') {
      const replyId = parseFlagValue(rest, '--id')
      const option = parseFlagValue(rest, '--option')
      const confirm = hasFlag(rest, '--yes')
      if (!replyId || !option || !/^\d+$/.test(option)) {
        throw new CliUsageError('Missing --id or invalid --option')
      }
      const previewOrSendReply = deps.previewOrSendReply ?? (async (input: { repoRoot: string; replyId: string; optionIndex: number; confirm: boolean }) => {
        return await defaultPreviewOrSendReply(input.repoRoot, input.replyId, input.optionIndex, input.confirm)
      })
      stdout.write(`${JSON.stringify(await previewOrSendReply({
        repoRoot,
        replyId,
        optionIndex: Number(option),
        confirm
      }), null, 2)}\n`)
      return 0
    }

    throw new CliUsageError('Unknown command')
  } catch (error) {
    if (error instanceof CliUsageError) {
      stderr.write(`${USAGE_TEXT}\n`)
      return 2
    }

    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 7
  }
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name)
}

function parseFlagValue(args: string[], name: string): string | null {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] ?? null : null
}

async function defaultSmokeCheck(repoRoot: string): Promise<unknown> {
  await ensurePromoScaffold(repoRoot)
  const client = createWebbridgeClient({})
  return await defaultSmokeCheckCore(client)
}

async function defaultRunDaily(repoRoot: string, publish: boolean): Promise<unknown> {
  const result = await defaultRunDailyOrchestratorCore({
    repoRoot,
    publish
  })

  if (!publish) {
    return result
  }

  const published = await defaultPublishQueuedPosts(repoRoot, 'all')
  return {
    ...result,
    published
  }
}

async function defaultPublishQueuedPosts(
  repoRoot: string,
  mode: 'all' | 'id',
  postId?: string
): Promise<{
  published: string[]
}> {
  const paths = await ensurePromoScaffold(repoRoot)
  const artifact = await readJsonFile<PromoTodayPostsArtifact>(paths.todayPostsJsonPath)
  const candidates = mode === 'all'
    ? artifact.posts.filter((post) => post.publishToday)
    : artifact.posts.filter((post) => post.id === postId)

  const client = createWebbridgeClient({})
  const published: string[] = []

  for (const candidate of candidates) {
    await publishPostCandidate(client, {
      repoRoot,
      sessionName: `promo-post-${candidate.id}`,
      assetsDir: paths.assetsDir,
      candidate,
      dryRun: false
    })
    await appendPostHistory(paths, {
      id: candidate.id,
      createdAt: new Date().toISOString(),
      topic: candidate.topic,
      text: candidate.text
    })
    published.push(candidate.id)
  }

  return { published }
}

async function defaultPreviewOrSendReply(
  repoRoot: string,
  replyId: string,
  optionIndex: number,
  confirm: boolean
): Promise<unknown> {
  const paths = await ensurePromoScaffold(repoRoot)
  const artifact = await readJsonFile<PromoReplyQueueArtifact>(paths.replyQueueJsonPath)
  const candidate = artifact.replies.find((reply) => reply.id === replyId)
  if (!candidate) {
    throw new Error(`Unknown reply id: ${replyId}`)
  }

  const client = createWebbridgeClient({})
  const result = await sendReplyCandidate(client, {
    sessionName: `promo-reply-${candidate.id}`,
    candidate,
    optionIndex,
    dryRun: !confirm
  })

  if (confirm) {
    await appendReplyHistory(paths, {
      id: candidate.id,
      createdAt: new Date().toISOString(),
      targetUrl: candidate.targetUrl,
      selectedOptionIndex: optionIndex,
      text: result.selectedText
    })
  }

  return result
}

async function readJsonFile<T>(path: string): Promise<T> {
  if (!existsSync(path)) {
    throw new Error(`Missing artifact: ${path}`)
  }
  return JSON.parse(await readFile(path, 'utf8')) as T
}

export function isDirectCliEntry(importMetaUrl: string, argvEntry: string | undefined): boolean {
  const entryPath = argvEntry?.replace(/\\/g, '/')
  const metaPath = importMetaUrl.replace(/^file:\/\//, '')
  return !!entryPath && (entryPath.endsWith(metaPath) || metaPath.endsWith(entryPath))
}

if (isDirectCliEntry(import.meta.url, process.argv[1])) {
  const exitCode = await run(process.argv.slice(2))
  process.exitCode = exitCode
}
