import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { TranscriptSnapshotArtifact } from '@core/memory/transcript-snapshot'
import type { CanonicalSessionEvent } from '@shared/project-session'

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
    const evidenceKey = buildEvidenceKey(input.event)

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
      evidenceKey
    }
  }
}

function buildEvidenceKey(event: CanonicalSessionEvent): string {
  const evidence = event.evidence
  if (!evidence) {
    throw new Error('Cannot compute an evidence key without event.evidence')
  }

  return `${evidence.rawSource.provider}:${evidence.providerSessionId ?? ''}:${evidence.turnId ?? event.event_id}`
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
