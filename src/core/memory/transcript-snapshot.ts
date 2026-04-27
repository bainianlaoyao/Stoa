import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import type { CanonicalSessionEvent } from '@shared/project-session'

export interface TranscriptSnapshotArtifact {
  kind: 'provider-transcript' | 'turn-slice'
  fileName: string
  content: Buffer
  sourceTranscriptPath?: string
}

interface ExtractedTurnSlice {
  version: 1
  eventId: string
  eventType: string
  sessionId: string
  projectId: string
  timestamp: string
  intent: CanonicalSessionEvent['payload']['intent']
  summary: string
  evidence: NonNullable<CanonicalSessionEvent['evidence']>
}

export async function createTranscriptSnapshot(event: CanonicalSessionEvent): Promise<TranscriptSnapshotArtifact> {
  const transcriptPath = event.evidence?.transcriptPath

  if (transcriptPath) {
    try {
      const content = await readFile(transcriptPath)
      return {
        kind: 'provider-transcript',
        fileName: `transcript${extname(transcriptPath) || '.txt'}`,
        content,
        sourceTranscriptPath: transcriptPath
      }
    } catch {
      // Fall through to the extracted turn slice when the provider-owned file is unavailable.
    }
  }

  return {
    kind: 'turn-slice',
    fileName: 'turn-slice.json',
    content: Buffer.from(JSON.stringify(buildTurnSlice(event), null, 2), 'utf8')
  }
}

function buildTurnSlice(event: CanonicalSessionEvent): ExtractedTurnSlice {
  if (!event.evidence) {
    throw new Error('Cannot build a transcript snapshot without event evidence')
  }

  return {
    version: 1,
    eventId: event.event_id,
    eventType: event.event_type,
    sessionId: event.session_id,
    projectId: event.project_id,
    timestamp: event.timestamp,
    intent: event.payload.intent,
    summary: event.payload.summary,
    evidence: event.evidence
  }
}
