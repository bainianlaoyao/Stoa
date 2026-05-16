import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import type {
  PromoHistorySnapshot,
  PromoPaths,
  PromoPostHistoryEntry,
  PromoReplyHistoryEntry,
  PromoRunLogEntry
} from './types'

export async function loadPromoHistory(paths: PromoPaths): Promise<PromoHistorySnapshot> {
  return {
    posts: await readJsonArray<PromoPostHistoryEntry>(paths.postHistoryPath),
    replies: await readJsonArray<PromoReplyHistoryEntry>(paths.replyHistoryPath),
    runs: await readJsonArray<PromoRunLogEntry>(paths.runLogPath)
  }
}

export async function appendPostHistory(paths: PromoPaths, entry: PromoPostHistoryEntry): Promise<void> {
  const posts = await readJsonArray<PromoPostHistoryEntry>(paths.postHistoryPath)
  posts.push(entry)
  await writeJson(paths.postHistoryPath, posts)
}

export async function appendReplyHistory(paths: PromoPaths, entry: PromoReplyHistoryEntry): Promise<void> {
  const replies = await readJsonArray<PromoReplyHistoryEntry>(paths.replyHistoryPath)
  replies.push(entry)
  await writeJson(paths.replyHistoryPath, replies)
}

export async function appendRunLog(paths: PromoPaths, entry: PromoRunLogEntry): Promise<void> {
  const runs = await readJsonArray<PromoRunLogEntry>(paths.runLogPath)
  runs.push(entry)
  await writeJson(paths.runLogPath, runs)
}

export function summarizeRecentTopics(posts: PromoPostHistoryEntry[], days: number): string[] {
  if (posts.length === 0) {
    return []
  }

  const newestTimestamp = Math.max(...posts.map((post) => Date.parse(post.createdAt)))
  const cutoff = newestTimestamp - (days * 24 * 60 * 60 * 1000)
  const seen = new Set<string>()
  const topics: string[] = []

  for (const post of posts) {
    if (Date.parse(post.createdAt) < cutoff) {
      continue
    }
    if (seen.has(post.topic)) {
      continue
    }
    seen.add(post.topic)
    topics.push(post.topic)
  }

  return topics
}

async function readJsonArray<T>(path: string): Promise<T[]> {
  if (!existsSync(path)) {
    return []
  }

  const parsed = JSON.parse(await readFile(path, 'utf8')) as T[]
  return Array.isArray(parsed) ? parsed : []
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

