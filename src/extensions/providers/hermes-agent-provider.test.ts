import { describe, expect, test } from 'vitest'
import { hermesAgentProvider } from './hermes-agent-provider'

describe('hermes-agent provider', () => {
  test('builds fresh and resume commands for the Hermes agent CLI', async () => {
    const target = {
      session_id: 'hermes_session_1',
      project_id: 'stoa-hermes',
      path: 'D:/Data/DEV/ultra_simple_panel',
      title: 'global-triage',
      type: 'hermes-agent' as const,
      external_session_id: null
    }
    const context = {
      webhookPort: 43127,
      sessionSecret: 'secret-hermes',
      providerPort: 43128
    }

    const fresh = await hermesAgentProvider.buildStartCommand(target, context)
    const resume = await hermesAgentProvider.buildResumeCommand(target, 'resume-123', context)

    expect(fresh.command).toBe('hermes-agent')
    expect(fresh.args).toContain('--stoa-hermes')
    expect(fresh.args).toEqual(expect.arrayContaining(['start', '--session-id', 'hermes_session_1']))
    expect(resume.args).toEqual(expect.arrayContaining(['resume', 'resume-123', '--stoa-hermes']))
    expect(fresh.env.STOA_SESSION_ID).toBe('hermes_session_1')
    expect(fresh.env.STOA_HERMES_SESSION_ID).toBe('hermes_session_1')
    expect(fresh.env.STOA_CTL_BASE_URL).toBe('http://127.0.0.1:43127')
    expect(fresh.env.STOA_CTL_TOKEN).toBe('secret-hermes')
  })
})
