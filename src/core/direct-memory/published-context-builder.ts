import { access, readFile } from 'node:fs/promises'
import { isAbsolute, relative } from 'node:path'
import type {
  EntireStoaCheckpointExport,
  EvolverPublishedContext,
  EvolverStoaRunResult,
  PublishedContextSourceRef,
  PublishedContextTarget
} from '@shared/direct-memory'

export interface BuildPublishedContextInput {
  checkpoint: EntireStoaCheckpointExport
  run: EvolverStoaRunResult
  repoRoot: string
  target: PublishedContextTarget
}

export type BuildPublishedContext = (input: BuildPublishedContextInput) => Promise<EvolverPublishedContext>

export const buildPublishedContext: BuildPublishedContext = async (input) => {
  const sourceRefs = await buildSourceRefs(input.repoRoot, input.checkpoint, input.run)
  const content = await buildPublishedContent(input)

  return {
    ok: input.run.ok,
    target: input.target,
    format: 'jsonl',
    run_id: input.run.run_id,
    source_checkpoint_id: input.checkpoint.checkpoint_id,
    source_refs: sourceRefs,
    content,
    metadata: {
      generated_at: new Date().toISOString(),
      token_budget: null,
      selection_policy: 'evolver-native-memory-graph-v1'
    },
    bridge: input.run.bridge,
    error: input.run.ok ? null : input.run.error
  }
}

async function buildPublishedContent(input: BuildPublishedContextInput): Promise<string> {
  if (input.target === 'claude-code' || input.target === 'codex') {
    const hookEntries = buildProviderHookEntries(input)
    if (hookEntries.length > 0) {
      return `${hookEntries.map((entry) => JSON.stringify(entry)).join('\n')}\n`
    }
  }

  return await readMemoryGraph(input.run.artifact_refs.memory_graph_ref)
}

function buildProviderHookEntries(input: BuildPublishedContextInput): Array<{
  timestamp: string
  gene_id: string
  signals: string[]
  outcome: {
    status: 'success'
    score: number
    note: string
  }
  source: string
  source_checkpoint_id: string
  source_session_id: string
}> {
  const noteSignals = input.run.signals
  const geneId = input.run.selected_gene_id ?? 'stoa_checkpoint_memory'
  const timestamp = new Date().toISOString()

  return input.checkpoint.sessions
    .map((session) => {
      const note = buildProviderHookNote(session)
      if (!note) {
        return null
      }

      return {
        timestamp,
        gene_id: geneId,
        signals: noteSignals,
        outcome: {
          status: 'success' as const,
          score: 0.9,
          note
        },
        source: 'stoa-direct-memory-publication',
        source_checkpoint_id: input.checkpoint.checkpoint_id,
        source_session_id: session.session_id
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
}

function buildProviderHookNote(session: EntireStoaCheckpointExport['sessions'][number]): string | null {
  const summary = normalizeInlineText(session.summary)
  if (summary) {
    return summary
  }

  const prompt = normalizeInlineText(session.prompt_text)
  if (prompt) {
    return `Imported preference from ${session.session_id}: ${prompt}`
  }

  return null
}

function normalizeInlineText(value: string | null): string | null {
  if (!value) {
    return null
  }

  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > 0 ? normalized : null
}

async function buildSourceRefs(
  repoRoot: string,
  checkpoint: EntireStoaCheckpointExport,
  run: EvolverStoaRunResult
): Promise<PublishedContextSourceRef[]> {
  const sourceRefs: PublishedContextSourceRef[] = [{
    kind: 'checkpoint_root',
    id: `${checkpoint.checkpoint_id}:root-metadata`,
    ref: normalizeRef(repoRoot, checkpoint.root_metadata_ref),
    score: null,
    reason: 'Entire checkpoint root metadata.'
  }]

  for (const session of checkpoint.sessions) {
    sourceRefs.push({
      kind: 'checkpoint_session',
      id: `${session.session_id}:metadata`,
      ref: normalizeRef(repoRoot, session.metadata_ref),
      score: null,
      reason: `Entire session metadata for ${session.session_id}.`
    })
    if (session.transcript_ref) {
      sourceRefs.push({
        kind: 'checkpoint_session',
        id: `${session.session_id}:transcript`,
        ref: normalizeRef(repoRoot, session.transcript_ref),
        score: null,
        reason: `Entire session transcript for ${session.session_id}.`
      })
    }
    if (session.prompt_ref) {
      sourceRefs.push({
        kind: 'checkpoint_session',
        id: `${session.session_id}:prompt`,
        ref: normalizeRef(repoRoot, session.prompt_ref),
        score: null,
        reason: `Entire prompt capture for ${session.session_id}.`
      })
    }
  }

  await pushIfPresent(sourceRefs, repoRoot, {
    kind: 'gene',
    id: run.selected_gene_id ?? `${run.run_id}:genes`,
    ref: run.artifact_refs.genes_ref,
    score: null,
    reason: run.selected_gene_id
      ? `Evolver state selected gene ${run.selected_gene_id}.`
      : 'Scoped Evolver gene store.'
  })
  await pushIfPresent(sourceRefs, repoRoot, {
    kind: 'capsule',
    id: `${run.run_id}:capsules`,
    ref: run.artifact_refs.capsules_ref,
    score: null,
    reason: 'Scoped Evolver capsule store.'
  })
  await pushIfPresent(sourceRefs, repoRoot, {
    kind: 'event_log',
    id: `${run.run_id}:events`,
    ref: run.artifact_refs.events_ref,
    score: null,
    reason: 'Scoped Evolver event log.'
  })
  await pushIfPresent(sourceRefs, repoRoot, {
    kind: 'failed_capsules',
    id: `${run.run_id}:failed-capsules`,
    ref: run.artifact_refs.failed_capsules_ref,
    score: null,
    reason: 'Scoped Evolver failed capsule log.'
  })
  await pushIfPresent(sourceRefs, repoRoot, {
    kind: 'memory_graph',
    id: `${run.run_id}:memory-graph`,
    ref: run.artifact_refs.memory_graph_ref,
    score: null,
    reason: 'Scoped Evolver memory graph used by native hooks.'
  })
  await pushIfPresent(sourceRefs, repoRoot, {
    kind: 'review_state',
    id: `${run.run_id}:review-state`,
    ref: run.artifact_refs.review_state_ref,
    score: null,
    reason: 'Scoped Evolver review state.'
  })
  await pushIfPresent(sourceRefs, repoRoot, {
    kind: 'stdout',
    id: `${run.run_id}:stdout`,
    ref: run.artifact_refs.stdout_ref,
    score: null,
    reason: 'Captured Evolver stdout.'
  })
  await pushIfPresent(sourceRefs, repoRoot, {
    kind: 'stderr',
    id: `${run.run_id}:stderr`,
    ref: run.artifact_refs.stderr_ref,
    score: null,
    reason: 'Captured Evolver stderr.'
  })

  return sourceRefs
}

async function pushIfPresent(
  sourceRefs: PublishedContextSourceRef[],
  repoRoot: string,
  input: {
    kind: PublishedContextSourceRef['kind']
    id: string
    ref: string | null
    score: number | null
    reason: string
  }
): Promise<void> {
  if (!input.ref || !await refExists(input.ref)) {
    return
  }

  sourceRefs.push({
    kind: input.kind,
    id: input.id,
    ref: normalizeRef(repoRoot, input.ref),
    score: input.score,
    reason: input.reason
  })
}

async function readMemoryGraph(filePath: string | null): Promise<string> {
  if (!filePath || !await refExists(filePath)) {
    return ''
  }

  return await readFile(filePath, 'utf-8')
}

async function refExists(ref: string): Promise<boolean> {
  if (!isAbsolute(ref)) {
    return true
  }

  try {
    await access(ref)
    return true
  } catch {
    return false
  }
}

function normalizeRef(repoRoot: string, ref: string): string {
  if (!isAbsolute(ref)) {
    return ref.replace(/\\/g, '/')
  }

  const relativeRef = relative(repoRoot, ref).replace(/\\/g, '/')
  return relativeRef.startsWith('..') ? ref.replace(/\\/g, '/') : relativeRef
}
