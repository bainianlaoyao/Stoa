import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { TranscriptSnapshotArtifact } from '@core/memory/transcript-snapshot'
import type { CanonicalSessionEvent } from '@shared/project-session'
import type {
  EvidenceRef,
  MemoryRuntimeEvidence,
  MemoryRuntimeEvidenceProvider,
  SessionEvidenceSnapshot
} from '@shared/memory-runtime'

export interface PersistSessionEvidenceInput {
  projectPath: string
  event: CanonicalSessionEvent
  snapshot: TranscriptSnapshotArtifact
}

export interface PersistSessionEvidenceResult {
  eventDirectoryPath: string
  metadataPath: string
  snapshotPath: string
  evidenceKey: string
  evidenceRef: EvidenceRef
}

interface PersistedSessionEvidenceMetadata {
  version: 1
  eventId: string
  eventType: string
  sessionId: string
  projectId: string
  timestamp: string
  source: CanonicalSessionEvent['source']
  intent: CanonicalSessionEvent['payload']['intent']
  summary: string
  payload: CanonicalSessionEvent['payload']
  provider: NonNullable<CanonicalSessionEvent['evidence']>['rawSource']['provider']
  providerSessionId: string | null
  turnId: string | null
  evidenceKey: string
  transcriptPointer: string | null
  snapshot: {
    kind: TranscriptSnapshotArtifact['kind']
    fileName: string
    sourceTranscriptPath: string | null
  }
  evidence: NonNullable<CanonicalSessionEvent['evidence']>
}

export class SessionEvidenceStore {
  async persist(input: PersistSessionEvidenceInput): Promise<PersistSessionEvidenceResult> {
    const evidence = input.event.evidence
    if (!evidence) {
      throw new Error('Cannot persist session evidence without event.evidence')
    }

    const eventDirectoryPath = join(
      input.projectPath,
      '.stoa',
      'memory',
      'evidence',
      input.event.session_id,
      input.event.event_id
    )
    const metadataPath = join(eventDirectoryPath, 'metadata.json')
    const snapshotPath = join(eventDirectoryPath, input.snapshot.fileName)
    const evidenceKey = buildEvidenceKey(input.event, input.snapshot)

    await mkdir(eventDirectoryPath, { recursive: true })
    await writeBufferAtomically(snapshotPath, input.snapshot.content)
    await writeJsonAtomically(metadataPath, {
      version: 1,
      eventId: input.event.event_id,
      eventType: input.event.event_type,
      sessionId: input.event.session_id,
      projectId: input.event.project_id,
      timestamp: input.event.timestamp,
      source: input.event.source,
      intent: input.event.payload.intent,
      summary: input.event.payload.summary,
      payload: input.event.payload,
      provider: evidence.rawSource.provider,
      providerSessionId: evidence.providerSessionId ?? null,
      turnId: evidence.turnId ?? null,
      evidenceKey,
      transcriptPointer: evidence.transcriptPath ?? null,
      snapshot: {
        kind: input.snapshot.kind,
        fileName: input.snapshot.fileName,
        sourceTranscriptPath: input.snapshot.sourceTranscriptPath ?? null
      },
      evidence
    } satisfies PersistedSessionEvidenceMetadata)

    return {
      eventDirectoryPath,
      metadataPath,
      snapshotPath,
      evidenceKey,
      evidenceRef: {
        evidenceId: input.event.event_id,
        projectId: input.event.project_id,
        stoaSessionId: input.event.session_id,
        providerSessionId: evidence.providerSessionId ?? null,
        turnId: evidence.turnId ?? null,
        eventId: input.event.event_id,
        eventType: input.event.event_type,
        evidenceKey,
        kind: input.snapshot.kind === 'provider-transcript' ? 'transcript' : 'turn-slice',
        metadataPath,
        path: snapshotPath,
        createdAt: input.event.timestamp,
        toolName: evidence.toolName ?? null
      }
    }
  }

  async listSnapshots(projectPath: string, stoaSessionId: string): Promise<SessionEvidenceSnapshot[]> {
    const sessionDirectoryPath = join(projectPath, '.stoa', 'memory', 'evidence', stoaSessionId)
    const entries = await readdir(sessionDirectoryPath, { withFileTypes: true }).catch(() => [])
    const snapshots: SessionEvidenceSnapshot[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue
      }

      const metadataPath = join(sessionDirectoryPath, entry.name, 'metadata.json')
      const metadata = await this.readMetadata(metadataPath)
      if (!metadata) {
        continue
      }

      const snapshotPath = join(sessionDirectoryPath, entry.name, metadata.snapshot.fileName)
      const snapshotContent = await readFile(snapshotPath, 'utf8').catch(() => null)
      if (snapshotContent === null) {
        continue
      }

      snapshots.push({
        eventId: metadata.eventId,
        eventType: metadata.eventType,
        sessionId: metadata.sessionId,
        projectId: metadata.projectId,
        timestamp: metadata.timestamp,
        provider: metadata.provider,
        providerSessionId: metadata.providerSessionId,
        turnId: metadata.turnId,
        evidenceKey: metadata.evidenceKey,
        payload: metadata.payload,
        evidence: metadata.evidence,
        snapshot: {
          kind: metadata.snapshot.kind,
          fileName: metadata.snapshot.fileName,
          content: snapshotContent,
          sourceTranscriptPath: metadata.snapshot.sourceTranscriptPath ?? null
        }
      })
    }

    return snapshots.sort((left, right) => {
      if (left.timestamp !== right.timestamp) {
        return left.timestamp.localeCompare(right.timestamp)
      }
      return left.eventId.localeCompare(right.eventId)
    })
  }

  async sealTurn(
    projectPath: string,
    stoaSessionId: string,
    turnId: string,
    evidenceIds: string[]
  ): Promise<void> {
    const filePath = join(
      projectPath,
      '.stoa',
      'memory',
      'evidence',
      stoaSessionId,
      'turns',
      `${turnId}.json`
    )
    await writeJsonAtomically(filePath, {
      version: 1,
      turnId,
      evidenceIds
    })
  }

  async listEvidenceRefsForTurn(
    projectPath: string,
    stoaSessionId: string,
    turnId: string
  ): Promise<EvidenceRef[]> {
    const filePath = join(
      projectPath,
      '.stoa',
      'memory',
      'evidence',
      stoaSessionId,
      'turns',
      `${turnId}.json`
    )

    const parsed = await readFile(filePath, 'utf8')
      .then(raw => JSON.parse(raw) as unknown)
      .catch(() => null)
    if (!isPersistedTurnSeal(parsed)) {
      return []
    }

    const refs: Array<EvidenceRef & { __sortTimestamp: string; __sortEventId: string }> = []
    for (const evidenceId of parsed.evidenceIds) {
      const metadataPath = join(
        projectPath,
        '.stoa',
        'memory',
        'evidence',
        stoaSessionId,
        evidenceId,
        'metadata.json'
      )
      const metadata = await this.readMetadata(metadataPath)
      if (!metadata) {
        continue
      }

      refs.push({
        evidenceId,
        projectId: metadata.projectId,
        stoaSessionId: metadata.sessionId,
        providerSessionId: metadata.providerSessionId,
        turnId: metadata.turnId,
        eventId: metadata.eventId,
        eventType: metadata.eventType,
        evidenceKey: metadata.evidenceKey,
        kind: metadata.snapshot.kind === 'provider-transcript' ? 'transcript' : 'turn-slice',
        metadataPath,
        path: join(dirname(metadataPath), metadata.snapshot.fileName),
        createdAt: metadata.timestamp,
        toolName: metadata.evidence.toolName ?? null,
        __sortTimestamp: metadata.timestamp,
        __sortEventId: metadata.eventId
      })
    }

    refs.sort((left, right) => {
      if (left.__sortTimestamp !== right.__sortTimestamp) {
        return left.__sortTimestamp.localeCompare(right.__sortTimestamp)
      }
      return left.__sortEventId.localeCompare(right.__sortEventId)
    })

    return refs.map(({ __sortTimestamp: _sortTimestamp, __sortEventId: _sortEventId, ...ref }) => ref)
  }

  private async readMetadata(filePath: string): Promise<PersistedSessionEvidenceMetadata | null> {
    try {
      const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown
      return isPersistedSessionEvidenceMetadata(parsed) ? parsed : null
    } catch {
      return null
    }
  }
}

function buildEvidenceKey(
  event: CanonicalSessionEvent,
  snapshot: TranscriptSnapshotArtifact
): string {
  const evidence = event.evidence
  if (!evidence) {
    throw new Error('Cannot compute an evidence key without event.evidence')
  }

  return `${evidence.rawSource.provider}:${evidence.providerSessionId ?? ''}:${resolveStableEvidenceSuffix(event, snapshot)}`
}

function resolveStableEvidenceSuffix(
  event: CanonicalSessionEvent,
  snapshot: TranscriptSnapshotArtifact
): string {
  if (event.evidence?.turnId) {
    return event.evidence.turnId
  }

  return `snapshot-sha256-${createHash('sha256').update(snapshot.content).digest('hex')}`
}

function createAtomicTempFilePath(filePath: string): string {
  return `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
}

async function writeJsonAtomically(filePath: string, payload: unknown): Promise<void> {
  await writeBufferAtomically(filePath, Buffer.from(JSON.stringify(payload, null, 2), 'utf8'))
}

async function writeBufferAtomically(filePath: string, content: Buffer): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const tempFilePath = createAtomicTempFilePath(filePath)

  try {
    await writeFile(tempFilePath, content)
    await rename(tempFilePath, filePath)
  } finally {
    await rm(tempFilePath, { force: true })
  }
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isProvider(value: unknown): value is MemoryRuntimeEvidenceProvider {
  return value === 'claude-code' || value === 'codex' || value === 'opencode'
}

function isPersistedSessionEvidenceMetadata(value: unknown): value is PersistedSessionEvidenceMetadata {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const record = value as Record<string, unknown>
  const snapshot = record.snapshot

  return record.version === 1
    && isString(record.eventId)
    && isString(record.eventType)
    && isString(record.sessionId)
    && isString(record.projectId)
    && isString(record.timestamp)
    && isProvider(record.provider)
    && isNullableString(record.providerSessionId)
    && isNullableString(record.turnId)
    && isString(record.evidenceKey)
    && isNullableString(record.transcriptPointer)
    && typeof record.payload === 'object'
    && record.payload !== null
    && typeof record.evidence === 'object'
    && record.evidence !== null
    && typeof snapshot === 'object'
    && snapshot !== null
    && (snapshot as Record<string, unknown>).kind !== undefined
    && (
      (snapshot as Record<string, unknown>).kind === 'provider-transcript'
      || (snapshot as Record<string, unknown>).kind === 'turn-slice'
    )
    && isString((snapshot as Record<string, unknown>).fileName)
    && isNullableString((snapshot as Record<string, unknown>).sourceTranscriptPath)
}

function isPersistedTurnSeal(value: unknown): value is {
  version: 1
  turnId: string
  evidenceIds: string[]
} {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const record = value as Record<string, unknown>
  return record.version === 1
    && isString(record.turnId)
    && Array.isArray(record.evidenceIds)
    && record.evidenceIds.every(isString)
}
