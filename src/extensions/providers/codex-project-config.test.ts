import { describe, expect, test } from 'vitest'
import {
  cleanupCodexProjectConfigContent,
  mergeCodexProjectConfigContent
} from './codex-project-config'

function sessionStartCommand(): string {
  return process.platform === 'win32'
    ? '.\\.stoa\\hook-dispatch.cmd codex SessionStart'
    : '.stoa/hook-dispatch codex SessionStart'
}

describe('codex project config', () => {
  test('merge preserves existing user config content while adding Stoa hooks', () => {
    const input = [
      '# user config',
      'model = "gpt-5"',
      '',
      '[model_providers.openai]',
      'name = "OpenAI"',
      'base_url = "https://api.openai.com/v1"',
      '',
      '[features] # preserve table and add hooks',
      'experimental = true',
      '',
      '[[hooks.SessionStart]]',
      'matcher = "user-defined"',
      '',
      '[[hooks.SessionStart.hooks]]',
      'type = "command"',
      'command = "user-session-start"',
      'timeout = 7',
      ''
    ].join('\n')

    const output = mergeCodexProjectConfigContent(input, 'D:/workspace/demo')

    expect(output).toContain('model = "gpt-5"')
    expect(output).toContain('[model_providers.openai]')
    expect(output).toContain('experimental = true')
    expect(output).toContain('command = "user-session-start"')
    expect(output).toContain(`command = ${JSON.stringify(sessionStartCommand())}`)
    expect(output).toContain('hooks = true')
    expect(output.match(/^\[features\](?:\s+#.*)?$/gm)).toHaveLength(1)
  })

  test('cleanup removes only Stoa-managed hooks and preserves user hooks', () => {
    const input = [
      'model = "gpt-5"',
      '',
      '[[hooks.SessionStart]]',
      'matcher = "user-defined"',
      '',
      '[[hooks.SessionStart.hooks]]',
      'type = "command"',
      'command = "user-session-start"',
      'timeout = 7',
      '',
      '[[hooks.SessionStart]]',
      'matcher = "startup|resume|clear"',
      '',
      '[[hooks.SessionStart.hooks]]',
      'type = "command"',
      `command = ${JSON.stringify(sessionStartCommand())}`,
      'timeout = 5',
      ''
    ].join('\n')

    const output = cleanupCodexProjectConfigContent(input)

    expect(output).toContain('command = "user-session-start"')
    expect(output).not.toContain(`command = ${JSON.stringify(sessionStartCommand())}`)
    expect(output).toContain('model = "gpt-5"')
  })

  test('cleanup removes Stoa-managed hook block that includes async flag and event_name', () => {
    const input = [
      'model = "gpt-5"',
      '',
      '[[hooks.SessionStart]]',
      'event_name = "session_start"',
      'matcher = "startup|resume|clear"',
      '',
      '[[hooks.SessionStart.hooks]]',
      'type = "command"',
      `command = ${JSON.stringify(sessionStartCommand())}`,
      'timeout = 5',
      'async = false',
      ''
    ].join('\n')

    const output = cleanupCodexProjectConfigContent(input)

    expect(output).toContain('model = "gpt-5"')
    expect(output).not.toContain('[[hooks.SessionStart]]')
    expect(output).not.toContain(`command = ${JSON.stringify(sessionStartCommand())}`)
  })
})
