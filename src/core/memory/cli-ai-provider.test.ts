import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/project-session'
import type {
  DistillationResponse,
  ReviewDecision,
  SemanticSessionSummary
} from '@shared/memory-runtime'
import { CliAiProvider } from './cli-ai-provider'
import {
  DISTILLATION_RESPONSE_SCHEMA,
  REVIEW_DECISION_RESPONSE_SCHEMA,
  SEMANTIC_SESSION_SUMMARY_RESPONSE_SCHEMA
} from './cli-ai-schemas'

describe('CliAiProvider', () => {
  let rootDir: string

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'stoa-cli-ai-provider-'))
  })

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true })
  })

  test('invokes Claude Code with the verified summarize command shape and parses structured output', async () => {
    const summary: SemanticSessionSummary = {
      summary: 'Installed the dependencies and fixed the lockfile drift.',
      outcome: 'success',
      lessons: ['Use uv for Python package changes.']
    }
    const execFile = vi.fn((_command, _args, _options, callback) => {
      callback(null, JSON.stringify({
        structured_output: summary,
        result: 'Human-readable summary'
      }), '')
    })
    const resolveExecutablePath = vi.fn().mockResolvedValue({
      shellPath: '/bin/zsh',
      providerPath: '/custom/bin/claude'
    })
    const provider = new CliAiProvider({
      settings: createSettings('claude-code'),
      execFile,
      resolveProviderExecutablePath: resolveExecutablePath
    })

    await expect(provider.summarizeSession({
      cwd: rootDir,
      prompt: 'Summarize this session.',
      timeoutMs: 9_000
    })).resolves.toEqual(summary)

    expect(resolveExecutablePath).toHaveBeenCalledWith(
      'claude-code',
      expect.objectContaining({ evolverInferenceProvider: 'claude-code' }),
      expect.objectContaining({
        detectShell: expect.any(Function),
        detectProvider: expect.any(Function)
      })
    )
    expect(execFile).toHaveBeenCalledWith(
      '/custom/bin/claude',
      [
        '-p',
        'Summarize this session.',
        '--bare',
        '--output-format',
        'json',
        '--json-schema',
        JSON.stringify(SEMANTIC_SESSION_SUMMARY_RESPONSE_SCHEMA),
        '--permission-mode',
        'bypassPermissions',
        '--tools',
        '',
        '--no-session-persistence'
      ],
      {
        cwd: rootDir,
        env: process.env,
        windowsHide: true,
        timeout: 9_000,
        maxBuffer: 10 * 1024 * 1024
      },
      expect.any(Function)
    )
  })

  test('invokes Codex with the verified distill command shape, writes the schema file, and parses the final JSONL agent message', async () => {
    const response: DistillationResponse = {
      responseText: '{"type":"Gene","id":"gene_distilled_uv","category":"repair","signals_match":["tooling_preference"],"strategy":["Use uv for Python package management."],"constraints":{"max_files":5,"forbidden_paths":[".git","node_modules"]}}'
    }
    const execFile = vi.fn(async (_command, args: string[], _options, callback) => {
      const schemaPath = args[5]
      const schemaText = await readFile(schemaPath, 'utf8')
      expect(JSON.parse(schemaText)).toEqual(DISTILLATION_RESPONSE_SCHEMA)

      callback(null, [
        'codex: warming cache',
        JSON.stringify({ type: 'item.started', item: { type: 'agent_message' } }),
        JSON.stringify({
          type: 'item.completed',
          item: {
            type: 'agent_message',
            text: JSON.stringify(response)
          }
        })
      ].join('\n'), '')
    })
    const resolveExecutablePath = vi.fn().mockResolvedValue({
      shellPath: null,
      providerPath: null
    })
    const provider = new CliAiProvider({
      settings: createSettings('codex'),
      execFile,
      resolveProviderExecutablePath: resolveExecutablePath
    })

    await expect(provider.distill({
      cwd: rootDir,
      prompt: 'Decide whether to distill this session.'
    })).resolves.toEqual(response)

    expect(execFile).toHaveBeenCalledTimes(1)
    const firstCall = execFile.mock.calls[0]
    expect(firstCall?.[0]).toBe('codex')
    expect(firstCall?.[1]).toEqual([
      'exec',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '--output-schema',
      expect.any(String),
      '--color',
      'never',
      '--json',
      '--cd',
      rootDir,
      'Decide whether to distill this session.'
    ])

    const schemaPath = firstCall?.[1]?.[5]
    await expect(access(schemaPath, constants.F_OK)).rejects.toThrow()
  })

  test('rejects Claude output when structured output is missing', async () => {
    const execFile = vi.fn((_command, _args, _options, callback) => {
      callback(null, JSON.stringify({ result: 'No machine output here.' }), '')
    })
    const provider = new CliAiProvider({
      settings: createSettings('claude-code'),
      execFile,
      resolveProviderExecutablePath: vi.fn().mockResolvedValue({
        shellPath: null,
        providerPath: null
      })
    })

    await expect(provider.review({
      cwd: rootDir,
      prompt: 'Review this change.'
    })).rejects.toThrow('Claude CLI did not return a valid structured_output payload')
  })

  test('rejects Codex output when the final agent message JSON is invalid', async () => {
    const execFile = vi.fn((_command, _args, _options, callback) => {
      callback(null, JSON.stringify({
        type: 'item.completed',
        item: {
          type: 'agent_message',
          text: '{"decision":"approve"'
        }
      }), '')
    })
    const provider = new CliAiProvider({
      settings: createSettings('codex'),
      execFile,
      resolveProviderExecutablePath: vi.fn().mockResolvedValue({
        shellPath: null,
        providerPath: null
      })
    })

    await expect(provider.review({
      cwd: rootDir,
      prompt: 'Review this change.'
    })).rejects.toThrow('Codex CLI returned invalid structured JSON')
  })

  test('falls back to default executable names, uses the default timeout, and validates parsed contracts', async () => {
    const execFile = vi.fn((_command, _args, options, callback) => {
      callback(null, JSON.stringify({
        structured_output: {
          summary: 'Missing outcome should fail validation.',
          lessons: ['Validation should reject this payload.']
        }
      }), '')
    })
    const provider = new CliAiProvider({
      settings: createSettings('claude-code'),
      execFile,
      resolveProviderExecutablePath: vi.fn().mockResolvedValue({
        shellPath: null,
        providerPath: null
      })
    })

    await expect(provider.summarizeSession({
      cwd: rootDir,
      prompt: 'Summarize this session.'
    })).rejects.toThrow('SemanticSessionSummary.outcome must be one of: success, failure, mixed, unknown')

    expect(execFile).toHaveBeenCalledWith(
      'claude',
      expect.any(Array),
      expect.objectContaining({
        timeout: 30_000
      }),
      expect.any(Function)
    )
  })

  test('rejects structured output objects with unknown keys', async () => {
    const execFile = vi.fn((_command, _args, _options, callback) => {
      callback(null, JSON.stringify({
        structured_output: {
          summary: 'Dependencies are aligned.',
          outcome: 'success',
          lessons: ['Prefer deterministic installers.'],
          extra: 'unexpected'
        }
      }), '')
    })
    const provider = new CliAiProvider({
      settings: createSettings('claude-code'),
      execFile,
      resolveProviderExecutablePath: vi.fn().mockResolvedValue({
        shellPath: null,
        providerPath: null
      })
    })

    await expect(provider.summarizeSession({
      cwd: rootDir,
      prompt: 'Summarize this session.'
    })).rejects.toThrow('SemanticSessionSummary must not include unknown keys: extra')
  })

  test('shell-wraps Windows PowerShell provider scripts instead of execFile launching them directly', async () => {
    const response: DistillationResponse = {
      responseText: '{"type":"Gene","id":"gene_distilled_windows","category":"optimize","signals_match":["windows_launcher"],"strategy":["Wrap PowerShell launchers."],"constraints":{"max_files":5,"forbidden_paths":[".git","node_modules"]}}'
    }
    const execFile = vi.fn((_command, _args, _options, callback) => {
      callback(null, JSON.stringify({
        type: 'item.completed',
        item: {
          type: 'agent_message',
          text: JSON.stringify(response)
        }
      }), '')
    })
    const provider = new CliAiProvider({
      settings: createSettings('codex'),
      execFile,
      resolveProviderExecutablePath: vi.fn().mockResolvedValue({
        shellPath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        providerPath: 'C:\\Users\\30280\\AppData\\Roaming\\npm\\codex.ps1'
      }),
      platform: 'win32'
    })

    await expect(provider.distill({
      cwd: rootDir,
      prompt: 'Decide whether to distill this session.'
    })).resolves.toEqual(response)

    expect(execFile).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-File',
        'C:\\Users\\30280\\AppData\\Roaming\\npm\\codex.ps1',
        'exec',
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        '--output-schema',
        expect.any(String),
        '--color',
        'never',
        '--json',
        '--cd',
        rootDir,
        'Decide whether to distill this session.'
      ],
      expect.objectContaining({
        cwd: rootDir,
        windowsHide: true
      }),
      expect.any(Function)
    )
  })

  test('keeps explicit extensionless Windows provider paths unchanged', async () => {
    const response: DistillationResponse = {
      responseText: '{"type":"Gene","id":"gene_distilled_explicit_path","category":"repair","signals_match":["explicit_provider_path"],"strategy":["Use the configured path exactly as provided."],"constraints":{"max_files":5,"forbidden_paths":[".git","node_modules"]}}'
    }
    const execFile = vi.fn((_command, _args, _options, callback) => {
      callback(null, JSON.stringify({
        type: 'item.completed',
        item: {
          type: 'agent_message',
          text: JSON.stringify(response)
        }
      }), '')
    })
    const provider = new CliAiProvider({
      settings: createSettings('codex'),
      execFile,
      resolveProviderExecutablePath: vi.fn().mockResolvedValue({
        shellPath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        providerPath: 'C:\\Users\\30280\\AppData\\Roaming\\npm\\codex'
      }),
      platform: 'win32'
    })

    await expect(provider.distill({
      cwd: rootDir,
      prompt: 'Decide whether to distill this session.'
    })).resolves.toEqual(response)

    expect(execFile).toHaveBeenCalledWith(
      'C:\\Users\\30280\\AppData\\Roaming\\npm\\codex',
      [
        'exec',
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        '--output-schema',
        expect.any(String),
        '--color',
        'never',
        '--json',
        '--cd',
        rootDir,
        'Decide whether to distill this session.'
      ],
      expect.objectContaining({
        cwd: rootDir,
        windowsHide: true
      }),
      expect.any(Function)
    )
  })

  test('rejects direct Windows cmd launchers for CLI AI execution', async () => {
    const execFile = vi.fn()
    const provider = new CliAiProvider({
      settings: createSettings('claude-code'),
      execFile,
      resolveProviderExecutablePath: vi.fn().mockResolvedValue({
        shellPath: 'C:\\Windows\\System32\\cmd.exe',
        providerPath: 'C:\\Users\\30280\\AppData\\Local\\Programs\\claude\\claude.cmd'
      }),
      platform: 'win32'
    })

    await expect(provider.summarizeSession({
      cwd: rootDir,
      prompt: 'Summarize this session.'
    })).rejects.toThrow(
      'Windows batch launchers are not supported for CLI AI provider execution: C:\\Users\\30280\\AppData\\Local\\Programs\\claude\\claude.cmd'
    )

    expect(execFile).not.toHaveBeenCalled()
  })

  test('deletes the Codex schema file when the command fails', async () => {
    let capturedSchemaPath = ''
    const execFile = vi.fn(async (_command, args: string[], _options, callback) => {
      capturedSchemaPath = args[5]
      callback(new Error('codex crashed'), '', 'fatal')
    })
    const provider = new CliAiProvider({
      settings: createSettings('codex'),
      execFile,
      resolveProviderExecutablePath: vi.fn().mockResolvedValue({
        shellPath: null,
        providerPath: null
      })
    })

    await expect(provider.distill({
      cwd: rootDir,
      prompt: 'Decide whether to distill this session.'
    })).rejects.toThrow('codex crashed')

    expect(capturedSchemaPath).not.toBe('')
    await expect(access(capturedSchemaPath, constants.F_OK)).rejects.toThrow()
  })

  test('exports the locked review schema contract', () => {
    expect(REVIEW_DECISION_RESPONSE_SCHEMA).toMatchObject({
      type: 'object',
      required: ['decision', 'summary', 'concerns']
    })
  })
})

function createSettings(evolverInferenceProvider: AppSettings['evolverInferenceProvider']): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    evolverInferenceProvider
  }
}
