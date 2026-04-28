import type {
  DistillationResponse,
  ReviewDecision,
  SemanticSessionSummary
} from '@shared/memory-runtime'

export interface CliAiBaseRequest {
  cwd: string
  prompt: string
  timeoutMs?: number
}

export interface SemanticSessionSummaryRequest extends CliAiBaseRequest {}

export interface ReviewDecisionRequest extends CliAiBaseRequest {}

export interface DistillationResponseRequest extends CliAiBaseRequest {}

type JsonSchema =
  | JsonSchemaObject
  | {
    type: 'string'
    enum?: string[]
  }
  | {
    type: 'array'
    items: JsonSchema
  }
  | {
    type: 'boolean'
  }

interface JsonSchemaObject {
  type: 'object'
  additionalProperties: false
  properties: Record<string, JsonSchema>
  required: string[]
}

export interface StructuredResponseContract<TResponse> {
  schema: JsonSchemaObject
  parse: (value: unknown) => TResponse
  stripUnknownKeys: (value: unknown) => Record<string, unknown>
}

export const SEMANTIC_SESSION_SUMMARY_RESPONSE_SCHEMA: JsonSchemaObject = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    outcome: {
      type: 'string',
      enum: ['success', 'failure', 'mixed', 'unknown']
    },
    lessons: {
      type: 'array',
      items: { type: 'string' }
    }
  },
  required: ['summary', 'outcome', 'lessons']
}

export const REVIEW_DECISION_RESPONSE_SCHEMA: JsonSchemaObject = {
  type: 'object',
  additionalProperties: false,
  properties: {
    decision: {
      type: 'string',
      enum: ['approve', 'reject']
    },
    summary: { type: 'string' },
    concerns: {
      type: 'array',
      items: { type: 'string' }
    }
  },
  required: ['decision', 'summary', 'concerns']
}

export const DISTILLATION_RESPONSE_SCHEMA: JsonSchemaObject = {
  type: 'object',
  additionalProperties: false,
  properties: {
    responseText: { type: 'string' }
  },
  required: ['responseText']
}

export const semanticSessionSummaryResponseContract: StructuredResponseContract<SemanticSessionSummary> = {
  schema: SEMANTIC_SESSION_SUMMARY_RESPONSE_SCHEMA,
  parse(value) {
    const record = asRecord(
      value,
      'SemanticSessionSummary',
      Object.keys(SEMANTIC_SESSION_SUMMARY_RESPONSE_SCHEMA.properties)
    )
    return {
      summary: readString(record, 'summary', 'SemanticSessionSummary'),
      outcome: readEnum(record, 'outcome', ['success', 'failure', 'mixed', 'unknown'], 'SemanticSessionSummary'),
      lessons: readStringArray(record, 'lessons', 'SemanticSessionSummary')
    }
  },
  stripUnknownKeys: (value) => stripToRecord(value, Object.keys(SEMANTIC_SESSION_SUMMARY_RESPONSE_SCHEMA.properties))
}

export const reviewDecisionResponseContract: StructuredResponseContract<ReviewDecision> = {
  schema: REVIEW_DECISION_RESPONSE_SCHEMA,
  parse(value) {
    const record = asRecord(
      value,
      'ReviewDecision',
      Object.keys(REVIEW_DECISION_RESPONSE_SCHEMA.properties)
    )
    return {
      decision: readEnum(record, 'decision', ['approve', 'reject'], 'ReviewDecision'),
      summary: readString(record, 'summary', 'ReviewDecision'),
      concerns: readStringArray(record, 'concerns', 'ReviewDecision')
    }
  },
  stripUnknownKeys: (value) => stripToRecord(value, Object.keys(REVIEW_DECISION_RESPONSE_SCHEMA.properties))
}

export const distillationResponseContract: StructuredResponseContract<DistillationResponse> = {
  schema: DISTILLATION_RESPONSE_SCHEMA,
  parse(value) {
    const record = asRecord(
      value,
      'DistillationResponse',
      Object.keys(DISTILLATION_RESPONSE_SCHEMA.properties)
    )
    return {
      responseText: readString(record, 'responseText', 'DistillationResponse')
    }
  },
  stripUnknownKeys: (value) => stripToRecord(value, Object.keys(DISTILLATION_RESPONSE_SCHEMA.properties))
}

function asRecord(
  value: unknown,
  contractName: string,
  allowedKeys: string[]
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${contractName} must be an object`)
  }

  const record = value as Record<string, unknown>
  const unknownKeys = Object.keys(record).filter(key => !allowedKeys.includes(key))
  if (unknownKeys.length > 0) {
    throw new Error(`${contractName} must not include unknown keys: ${unknownKeys.join(', ')}`)
  }

  return record
}

function stripToRecord(value: unknown, allowedKeys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  const source = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const key of allowedKeys) {
    if (key in source) {
      result[key] = source[key]
    }
  }
  return result
}

function readString(record: Record<string, unknown>, key: string, contractName: string): string {
  const value = record[key]
  if (typeof value === 'string') {
    return value
  }
  if (value !== null && value !== undefined) {
    return JSON.stringify(value)
  }
  throw new Error(`${contractName}.${key} must be a string`)
}

function readBoolean(record: Record<string, unknown>, key: string, contractName: string): boolean {
  const value = record[key]
  if (typeof value !== 'boolean') {
    throw new Error(`${contractName}.${key} must be a boolean`)
  }
  return value
}

function readStringArray(record: Record<string, unknown>, key: string, contractName: string): string[] {
  const value = record[key]
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) {
    throw new Error(`${contractName}.${key} must be a string[]`)
  }
  return [...value]
}

function readEnum<TValue extends string>(
  record: Record<string, unknown>,
  key: string,
  values: readonly TValue[],
  contractName: string
): TValue {
  const value = record[key]
  if (typeof value !== 'string' || !values.includes(value as TValue)) {
    throw new Error(`${contractName}.${key} must be one of: ${values.join(', ')}`)
  }
  return value as TValue
}
