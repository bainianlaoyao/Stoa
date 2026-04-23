import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PtyHost } from './pty-host'
import type { ProviderCommand } from '@shared/project-session'

interface MockTerminal {
  onData: ReturnType<typeof vi.fn>
  onExit: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  _onData: ((data: string) => void) | null
  _onExit: ((info: { exitCode: number }) => void) | null
}

const mockTerminals: MockTerminal[] = []

function createMockTerminal(): MockTerminal {
  const terminal: MockTerminal = {
    onData: vi.fn((cb: (data: string) => void) => {
      terminal._onData = cb
    }),
    onExit: vi.fn((cb: (info: { exitCode: number }) => void) => {
      terminal._onExit = cb
    }),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    _onData: null,
    _onExit: null,
  }
  mockTerminals.push(terminal)
  return terminal
}

vi.mock('node-pty', () => {
  return {
    default: {
      spawn: vi.fn(() => createMockTerminal())
    }
  }
})

const defaultCommand: ProviderCommand = {
  command: 'bash',
  args: ['-l'],
  cwd: '/home',
  env: { PATH: '/usr/bin' },
}

describe('PtyHost', () => {
  let host: PtyHost

  beforeEach(() => {
    host = new PtyHost()
    mockTerminals.length = 0
    vi.clearAllMocks()
  })

  afterEach(() => {
    host.dispose()
  })

  function lastTerminal(): MockTerminal {
    return mockTerminals[mockTerminals.length - 1]
  }

  describe('start()', () => {
    test('calls pty.spawn with correct parameters', async () => {
      const { default: pty } = await import('node-pty')

      host.start('rt-1', defaultCommand, vi.fn(), vi.fn())

      expect(pty.spawn).toHaveBeenCalledWith(
        'bash',
        ['-l'],
        {
          cwd: '/home',
          name: 'xterm-color',
          cols: 120,
          rows: 30,
          env: { PATH: '/usr/bin' },
        }
      )
    })

    test('returns PtySession with runtimeId only', () => {
      const result = host.start('rt-1', defaultCommand, vi.fn(), vi.fn())

      expect(result).toEqual({ runtimeId: 'rt-1' })
    })

    test('registers onData callback on the terminal', () => {
      const myOnData = vi.fn()

      host.start('rt-1', defaultCommand, myOnData, vi.fn())

      expect(lastTerminal().onData).toHaveBeenCalledWith(myOnData)
    })

    test('registers onExit callback on the terminal', () => {
      const myOnExit = vi.fn()

      host.start('rt-1', defaultCommand, vi.fn(), myOnExit)

      expect(lastTerminal().onExit).toHaveBeenCalled()
    })

    test('onExit callback removes session from map and forwards exitCode', () => {
      const myOnExit = vi.fn()
      const terminal = lastTerminal.bind(null)

      host.start('rt-1', defaultCommand, vi.fn(), myOnExit)

      // Simulate terminal exit
      const mockTerm = lastTerminal()
      mockTerm._onExit!({ exitCode: 42 })

      expect(myOnExit).toHaveBeenCalledWith(42)

      // Session should be removed — write should do nothing
      const writeSpy = mockTerm.write
      host.write('rt-1', 'should not arrive')
      expect(writeSpy).not.toHaveBeenCalledWith('should not arrive')
    })

    test('onData callback forwards data to provided handler', () => {
      const myOnData = vi.fn()

      host.start('rt-1', defaultCommand, myOnData, vi.fn())

      const mockTerm = lastTerminal()
      mockTerm._onData!('hello world')

      expect(myOnData).toHaveBeenCalledWith('hello world')
    })

    test('can start multiple sessions with different runtime IDs', () => {
      const result1 = host.start('rt-1', defaultCommand, vi.fn(), vi.fn())
      const term1 = mockTerminals[mockTerminals.length - 1]

      const result2 = host.start('rt-2', { ...defaultCommand, command: 'zsh' }, vi.fn(), vi.fn())
      const term2 = mockTerminals[mockTerminals.length - 1]

      expect(result1).toEqual({ runtimeId: 'rt-1' })
      expect(result2).toEqual({ runtimeId: 'rt-2' })

      // Both sessions should be tracked — write to both
      host.write('rt-1', 'data1')
      host.write('rt-2', 'data2')

      expect(term1.write).toHaveBeenCalledWith('data1')
      expect(term2.write).toHaveBeenCalledWith('data2')
    })
  })

  describe('write()', () => {
    test('writes data to the correct terminal', () => {
      host.start('rt-1', defaultCommand, vi.fn(), vi.fn())
      const mockTerm = lastTerminal()

      host.write('rt-1', 'ls -la\n')

      expect(mockTerm.write).toHaveBeenCalledWith('ls -la\n')
    })

    test('does nothing for unknown runtimeId', () => {
      host.start('rt-1', defaultCommand, vi.fn(), vi.fn())

      expect(() => host.write('unknown', 'data')).not.toThrow()
      expect(lastTerminal().write).not.toHaveBeenCalledWith('data')
    })

    test('does nothing after session exits', () => {
      host.start('rt-1', defaultCommand, vi.fn(), vi.fn())
      const mockTerm = lastTerminal()

      // Trigger exit to remove session
      mockTerm._onExit!({ exitCode: 0 })

      host.write('rt-1', 'data')
      expect(mockTerm.write).not.toHaveBeenCalled()
    })
  })

  describe('resize()', () => {
    test('resizes the correct terminal', () => {
      host.start('rt-1', defaultCommand, vi.fn(), vi.fn())
      const mockTerm = lastTerminal()

      host.resize('rt-1', 80, 24)

      expect(mockTerm.resize).toHaveBeenCalledWith(80, 24)
    })

    test('rejects cols < 2', () => {
      host.start('rt-1', defaultCommand, vi.fn(), vi.fn())
      const mockTerm = lastTerminal()

      host.resize('rt-1', 1, 24)

      expect(mockTerm.resize).not.toHaveBeenCalled()
    })

    test('rejects rows < 2', () => {
      host.start('rt-1', defaultCommand, vi.fn(), vi.fn())
      const mockTerm = lastTerminal()

      host.resize('rt-1', 80, 1)

      expect(mockTerm.resize).not.toHaveBeenCalled()
    })

    test('rejects cols=0 rows=0', () => {
      host.start('rt-1', defaultCommand, vi.fn(), vi.fn())
      const mockTerm = lastTerminal()

      host.resize('rt-1', 0, 0)

      expect(mockTerm.resize).not.toHaveBeenCalled()
    })

    test('accepts minimum valid size cols=2 rows=2', () => {
      host.start('rt-1', defaultCommand, vi.fn(), vi.fn())
      const mockTerm = lastTerminal()

      host.resize('rt-1', 2, 2)

      expect(mockTerm.resize).toHaveBeenCalledWith(2, 2)
    })

    test('does nothing for unknown runtimeId', () => {
      host.start('rt-1', defaultCommand, vi.fn(), vi.fn())

      expect(() => host.resize('unknown', 80, 24)).not.toThrow()
      expect(lastTerminal().resize).not.toHaveBeenCalled()
    })
  })

  describe('kill()', () => {
    test('kills a specific terminal by runtimeId', () => {
      host.start('rt-1', defaultCommand, vi.fn(), vi.fn())
      host.start('rt-2', defaultCommand, vi.fn(), vi.fn())
      const term1 = mockTerminals[mockTerminals.length - 2]
      const term2 = mockTerminals[mockTerminals.length - 1]

      host.kill('rt-1')

      expect(term1.kill).toHaveBeenCalled()
      expect(term2.kill).not.toHaveBeenCalled()
    })

    test('removes killed session from map', () => {
      host.start('rt-1', defaultCommand, vi.fn(), vi.fn())
      const mockTerm = lastTerminal()

      host.kill('rt-1')

      host.write('rt-1', 'data')
      expect(mockTerm.write).not.toHaveBeenCalled()
    })

    test('does nothing for unknown runtimeId', () => {
      host.start('rt-1', defaultCommand, vi.fn(), vi.fn())

      expect(() => host.kill('unknown')).not.toThrow()
      expect(lastTerminal().kill).not.toHaveBeenCalled()
    })
  })

  describe('dispose()', () => {
    test('kills all active terminals', () => {
      host.start('rt-1', defaultCommand, vi.fn(), vi.fn())
      host.start('rt-2', defaultCommand, vi.fn(), vi.fn())
      host.start('rt-3', defaultCommand, vi.fn(), vi.fn())

      host.dispose()

      expect(mockTerminals[0].kill).toHaveBeenCalled()
      expect(mockTerminals[1].kill).toHaveBeenCalled()
      expect(mockTerminals[2].kill).toHaveBeenCalled()
    })

    test('clears the sessions map', () => {
      host.start('rt-1', defaultCommand, vi.fn(), vi.fn())
      const mockTerm = lastTerminal()

      host.dispose()

      // Session cleared — write should not reach terminal
      host.write('rt-1', 'data')
      expect(mockTerm.write).not.toHaveBeenCalled()
    })

    test('handles empty sessions gracefully', () => {
      expect(() => new PtyHost().dispose()).not.toThrow()
    })
  })
})
