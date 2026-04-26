import { stat } from 'node:fs/promises'
import type { AppSettings, OpenWorkspaceRequest, ProjectSummary, SessionSummary } from '@shared/project-session'
import { detectVscode } from '@core/settings-detector'

export interface WorkspaceSpawnOptions {
  cwd: string
  detached: boolean
  stdio: 'ignore'
  windowsHide: boolean
  shell: false
  env: NodeJS.ProcessEnv
}

export interface WorkspaceChildProcess {
  unref: () => void
}

export type WorkspaceShellOpenPath = (path: string) => Promise<string>
export type WorkspaceSpawnProcess = (
  executable: string,
  args: string[],
  options: WorkspaceSpawnOptions
) => WorkspaceChildProcess

export interface OpenWorkspaceOptions {
  request: unknown
  projects: ProjectSummary[]
  sessions: SessionSummary[]
  settings: AppSettings
  shellOpenPath: WorkspaceShellOpenPath
  spawnProcess: WorkspaceSpawnProcess
}

const VSCODE_AUTO_DETECT_CANDIDATES = ['code', 'code.cmd'] as const
const VSCODE_LAUNCH_ERROR = 'Unable to open workspace in VS Code. Configure the VS Code executable path in settings.'

export function validateOpenWorkspaceRequest(request: unknown): OpenWorkspaceRequest {
  if (typeof request !== 'object' || request === null) {
    throw new Error('Invalid workspace open request.')
  }

  const candidate = request as { sessionId?: unknown; target?: unknown }
  if (typeof candidate.sessionId !== 'string' || candidate.sessionId.trim().length === 0) {
    throw new Error('Invalid workspace open request.')
  }

  if (candidate.target !== 'ide' && candidate.target !== 'file-manager') {
    throw new Error('Invalid workspace open target.')
  }

  return {
    sessionId: candidate.sessionId,
    target: candidate.target
  }
}

export async function openWorkspace(options: OpenWorkspaceOptions): Promise<void> {
  const request = validateOpenWorkspaceRequest(options.request)
  const session = options.sessions.find((candidate) => candidate.id === request.sessionId)
  if (!session) {
    throw new Error('Unable to open workspace: session was not found.')
  }

  const project = options.projects.find((candidate) => candidate.id === session.projectId)
  if (!project) {
    throw new Error('Unable to open workspace: project was not found.')
  }

  await assertDirectory(project.path, 'Unable to open workspace: project path is not a directory.')

  if (request.target === 'file-manager') {
    await openFileManager(project.path, options.shellOpenPath)
    return
  }

  await openIde(project.path, options.settings, options.spawnProcess)
}

async function openFileManager(workspacePath: string, shellOpenPath: WorkspaceShellOpenPath): Promise<void> {
  const errorMessage = await shellOpenPath(workspacePath)
  if (errorMessage) {
    throw new Error(`Unable to open workspace in file browser: ${errorMessage}`)
  }
}

async function openIde(
  workspacePath: string,
  settings: AppSettings,
  spawnProcess: WorkspaceSpawnProcess
): Promise<void> {
  const configuredExecutable = settings.workspaceIde.executablePath.trim()

  let candidates: string[]
  if (configuredExecutable.length > 0) {
    await assertFile(configuredExecutable, VSCODE_LAUNCH_ERROR)
    candidates = [configuredExecutable]
  } else {
    const detected = await detectVscode()
    candidates = detected ? [detected] : [...VSCODE_AUTO_DETECT_CANDIDATES]
  }

  const spawnOptions: WorkspaceSpawnOptions = {
    cwd: workspacePath,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    shell: false,
    env: process.env
  }

  for (const executable of candidates) {
    try {
      const child = spawnProcess(executable, [workspacePath], spawnOptions)
      child.unref()
      return
    } catch {
      continue
    }
  }

  throw new Error(VSCODE_LAUNCH_ERROR)
}

async function assertDirectory(path: string, message: string): Promise<void> {
  try {
    const result = await stat(path)
    if (!result.isDirectory()) {
      throw new Error(message)
    }
  } catch {
    throw new Error(message)
  }
}

async function assertFile(path: string, message: string): Promise<void> {
  try {
    const result = await stat(path)
    if (!result.isFile()) {
      throw new Error(message)
    }
  } catch {
    throw new Error(message)
  }
}
