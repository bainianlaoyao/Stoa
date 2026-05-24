import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { _electron as electron, expect as playwrightExpect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { createTestTempDir } from '../../../testing/test-temp'
import { readPortFile } from '../stoa-ctl-port-file'
import type { PromoAsset, PromoAssetCategory, PromoAssetKind, PromoAssetSource } from './types'
import { resolveNewSessionDebugSnapshot } from './session-capture-identification'
import {
  createPermissionBlockedPromoHookRequest,
  getWeakPromoCapturePreset
} from './weak-capture-tuning'

export interface StableCaptureAssetInventoryItem {
  relativePath: string
  note: string
  alt: string
  category: PromoAssetCategory
  scene: string
  kind: PromoAssetKind
  tags: string[]
  source: PromoAssetSource
  derivesFrom: string[]
}

type CaptureAsset = StableCaptureAssetInventoryItem

interface PromoDebugSessionSnapshot {
  id: string
  projectId: string
  title: string
  runtimeState: string
  turnState: string
  lastTurnOutcome: string
  hasUnseenCompletion: boolean
  blockingReason: string | null
  failureReason: string | null
  summary: string | null
}

interface PromoMainE2EDebugState {
  webhookPort: number | null
  sessionSecrets: Record<string, string>
  snapshot: {
    sessions: PromoDebugSessionSnapshot[]
  } | null
}

interface PromoMainE2EDebugApi {
  getDebugState: () => PromoMainE2EDebugState
  queueDialogPickFolder: (path: string | null) => void
  appendTerminalData: (sessionId: string, data: string) => Promise<void>
}

export interface SeededProjectHandle {
  row: Locator
  title: string
}

export interface SeededSessionHandle {
  id: string
  projectId: string
  secret: string | null
  row: Locator
  title: string
}

export interface SeededMetaSessionHandle {
  id: string
  row: Locator
  title: string
}

export interface SeededCaptureContent {
  projects: {
    workspace: SeededProjectHandle
    lab: SeededProjectHandle
  }
  sessions: {
    workspaceShell: SeededSessionHandle
    workspaceOpencode: SeededSessionHandle
    workspaceCodex: SeededSessionHandle
    workspaceClaude: SeededSessionHandle
    archivedClaude: SeededSessionHandle
  }
  meta: {
    active: SeededMetaSessionHandle
    archived: SeededMetaSessionHandle
  }
}

export interface CaptureExecutionContext {
  repoRoot: string
  outputDir: string
  electronApp: ElectronApplication
  page: Page
  stateDir: string
  seeded: SeededCaptureContent
}

export interface CanonicalCaptureOutput {
  asset: CaptureAsset
  absolutePath: string
}

export interface CanonicalPromoScene {
  scene: string
  assets: CaptureAsset[]
  execute: (context: CaptureExecutionContext) => Promise<CanonicalCaptureOutput[]>
}

interface ResolvedDebugSession {
  session: PromoDebugSessionSnapshot
  secret: string | null
  webhookPort: number
}

const LONG_PRESS_MS = 260

const STABLE_CAPTURE_ASSET_INVENTORY: StableCaptureAssetInventoryItem[] = [
  {
    relativePath: 'generated/overview-app-shell/01.png',
    note: 'Shows the main Stoa shell with workspace hierarchy on the left and a live terminal surface on the right. It is the quickest “what this product feels like” overview shot.',
    alt: 'Stoa app shell with workspace hierarchy and a live terminal session visible.',
    category: 'overview',
    scene: 'app-shell',
    kind: 'screenshot',
    tags: ['overview', 'shell', 'workspace', 'terminal'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/overview-workspace-multi-session/01.png',
    note: 'Shows that one workspace can hold multiple sessions side by side in the same project tree, which is a core part of the product mental model.',
    alt: 'Workspace hierarchy with multiple sessions grouped under projects in Stoa.',
    category: 'overview',
    scene: 'workspace-multi-session',
    kind: 'screenshot',
    tags: ['overview', 'workspace', 'multi-session'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/overview-provider-mix/01.png',
    note: 'Shows that shell, OpenCode, Codex, and Claude Code sessions can all live in the same workspace instead of being split across separate tools.',
    alt: 'A Stoa project showing multiple provider types in one workspace list.',
    category: 'overview',
    scene: 'provider-mix',
    kind: 'screenshot',
    tags: ['overview', 'providers', 'mix', 'workspace'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/overview-settings-surface/01.png',
    note: 'Shows the full settings surface so people can see that Stoa is not just a terminal wrapper, but an opinionated local workstation.',
    alt: 'The Stoa settings surface with navigation and configuration panels visible.',
    category: 'overview',
    scene: 'settings-surface',
    kind: 'screenshot',
    tags: ['overview', 'settings'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/overview-update-status-surface/01.png',
    note: 'Shows the built-in update status card in the About section. It helps convey that the project ships actively and exposes update state inside the product.',
    alt: 'Stoa About panel showing the update status card.',
    category: 'overview',
    scene: 'update-status-surface',
    kind: 'screenshot',
    tags: ['overview', 'settings', 'updates', 'release-velocity'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/overview-terminal-live-output/01.png',
    note: 'Shows an active terminal with real replayed output, so the material does not feel like a static settings demo.',
    alt: 'A Stoa terminal session showing live output inside the workspace.',
    category: 'overview',
    scene: 'terminal-live-output',
    kind: 'screenshot',
    tags: ['overview', 'terminal', 'live-output'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/workflow-new-session-floating-entry/01.png',
    note: 'Shows the quick add-session flow using the floating provider card anchored to a project row. It explains the default, low-friction way to start a session.',
    alt: 'A project row in Stoa with the floating provider card open for creating a new session.',
    category: 'workflow',
    scene: 'new-session-floating-entry',
    kind: 'screenshot',
    tags: ['workflow', 'new-session', 'provider-card'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/workflow-new-session-radial-entry/01.png',
    note: 'Shows the long-press radial entry for new sessions. This is one of the more memorable interaction details and deserves a dedicated workflow shot.',
    alt: 'A Stoa project row with the radial new-session menu visible.',
    category: 'workflow',
    scene: 'new-session-radial-entry',
    kind: 'screenshot',
    tags: ['workflow', 'new-session', 'radial-menu'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/workflow-session-maintenance-menu/01.png',
    note: 'Shows the session maintenance menu opened from an existing session row, making restart and title regeneration discoverable in one frame.',
    alt: 'A Stoa session row with its context menu open.',
    category: 'workflow',
    scene: 'session-maintenance-menu',
    kind: 'screenshot',
    tags: ['workflow', 'session', 'context-menu', 'maintenance'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/workflow-session-archive-to-restore/01.png',
    note: 'Shows the archive-to-restore loop from both sides: first the archived session waiting in the archive surface, then the same session returned to the active command surface.',
    alt: 'The Stoa archive surface with a restorable archived session visible.',
    category: 'workflow',
    scene: 'session-archive-to-restore-archive',
    kind: 'screenshot',
    tags: ['workflow', 'archive', 'restore'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/workflow-session-archive-to-restore/02.png',
    note: 'Shows the archive-to-restore loop from both sides: first the archived session waiting in the archive surface, then the same session returned to the active command surface.',
    alt: 'The Stoa command surface after restoring an archived session.',
    category: 'workflow',
    scene: 'session-archive-to-restore-restored',
    kind: 'screenshot',
    tags: ['workflow', 'archive', 'restore'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/closeup-provider-floating-card/01.png',
    note: 'A close crop of the floating provider card, useful when a post wants to talk about elegant session creation rather than the whole app.',
    alt: 'Close-up of the floating provider card used to create sessions in Stoa.',
    category: 'closeup',
    scene: 'provider-floating-card',
    kind: 'screenshot',
    tags: ['closeup', 'provider-card', 'new-session'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/closeup-provider-radial-menu/01.png',
    note: 'A close crop of the long-press radial provider menu, focused on the interaction detail itself.',
    alt: 'Close-up of the radial provider menu in Stoa.',
    category: 'closeup',
    scene: 'provider-radial-menu',
    kind: 'screenshot',
    tags: ['closeup', 'radial-menu', 'new-session'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/closeup-session-context-menu-restart/01.png',
    note: 'A close crop of the session context menu with restart visible. This is useful for posts about recovery and maintenance details.',
    alt: 'Close-up of the Stoa session context menu showing restart.',
    category: 'closeup',
    scene: 'session-context-menu-restart',
    kind: 'screenshot',
    tags: ['closeup', 'context-menu', 'restart', 'session'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/closeup-session-status-ready/01.png',
    note: 'Shows the ready session state as a compact row-level status close-up.',
    alt: 'A Stoa session row showing the ready status.',
    category: 'closeup',
    scene: 'session-status-ready',
    kind: 'screenshot',
    tags: ['closeup', 'status', 'ready', 'session'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/closeup-session-status-running/01.png',
    note: 'Shows the running session state as a compact row-level status close-up.',
    alt: 'A Stoa session row showing the running status.',
    category: 'closeup',
    scene: 'session-status-running',
    kind: 'screenshot',
    tags: ['closeup', 'status', 'running', 'session'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/closeup-session-status-blocked/01.png',
    note: 'Shows the blocked session state, which is especially useful for explaining approval or permission pauses in a live workflow.',
    alt: 'A Stoa session row showing the blocked status.',
    category: 'closeup',
    scene: 'session-status-blocked',
    kind: 'screenshot',
    tags: ['closeup', 'status', 'blocked', 'session'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/closeup-session-status-complete/01.png',
    note: 'Shows the completed session state before the completion is cleared by user attention.',
    alt: 'A Stoa session row showing the complete status.',
    category: 'closeup',
    scene: 'session-status-complete',
    kind: 'screenshot',
    tags: ['closeup', 'status', 'complete', 'session'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/closeup-session-status-failure/01.png',
    note: 'Shows the failure state with the same row-level visual language, useful when talking about observability or recoverability.',
    alt: 'A Stoa session row showing the failure status.',
    category: 'closeup',
    scene: 'session-status-failure',
    kind: 'screenshot',
    tags: ['closeup', 'status', 'failure', 'session'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/meta-meta-session-overview/01.png',
    note: 'Shows the main meta session surface with sidebar, terminal deck, and inspector in one view.',
    alt: 'The Stoa meta session surface overview.',
    category: 'meta',
    scene: 'meta-session-overview',
    kind: 'screenshot',
    tags: ['meta', 'meta-session', 'overview'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/meta-meta-session-archived-list/01.png',
    note: 'Shows that meta sessions also have an archived list, reinforcing that archive and restore are first-class behaviors across the product.',
    alt: 'The meta session sidebar with the archived session list expanded.',
    category: 'meta',
    scene: 'meta-session-archived-list',
    kind: 'screenshot',
    tags: ['meta', 'meta-session', 'archive'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/meta-meta-session-restore-action/01.png',
    note: 'Shows the restore action on an archived meta session row, making the recovery affordance visible without needing a long explanation.',
    alt: 'An archived meta session row with its restore action visible.',
    category: 'meta',
    scene: 'meta-session-restore-action',
    kind: 'screenshot',
    tags: ['meta', 'meta-session', 'restore', 'archive'],
    source: 'electron-capture',
    derivesFrom: []
  }
]

const STABLE_CAPTURE_ASSET_MAP = new Map(
  STABLE_CAPTURE_ASSET_INVENTORY.map((asset) => [asset.relativePath, asset] as const)
)

export function listStableCaptureAssetInventory(): StableCaptureAssetInventoryItem[] {
  return STABLE_CAPTURE_ASSET_INVENTORY.map((asset) => ({
    ...asset,
    tags: [...asset.tags],
    derivesFrom: [...asset.derivesFrom]
  }))
}

export async function runCanonicalPromoCapture(input: {
  repoRoot: string
  outputDir: string
  scenes?: CanonicalPromoScene[]
}): Promise<CanonicalCaptureOutput[]> {
  const entryPath = join(input.repoRoot, 'out', 'main', 'index.cjs')
  if (!existsSync(entryPath)) {
    throw new Error(`Electron main entry not found at ${entryPath}. Run "npm run build" first.`)
  }

  const stateDir = await createTestTempDir('stoa-final-promo-capture-')
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[0] !== 'ELECTRON_RENDERER_URL'
      )
    ),
    NODE_ENV: 'test',
    VIBECODING_E2E: '1',
    VIBECODING_STATE_DIR: stateDir
  }

  const electronApp = await electron.launch({
    args: [entryPath],
    env
  })

  try {
    const page = await electronApp.firstWindow()
    await playwrightExpect(page.getByTestId('app-viewport')).toBeVisible({ timeout: 15_000 })
    await playwrightExpect(page.getByTestId('command-panel')).toBeVisible({ timeout: 15_000 })

    await installFakeRuntimeProviders(page, stateDir)
    const seeded = await seedCaptureContent(electronApp, page)
    const context: CaptureExecutionContext = {
      repoRoot: input.repoRoot,
      outputDir: input.outputDir,
      electronApp,
      page,
      stateDir,
      seeded
    }

    const outputs: CanonicalCaptureOutput[] = []
    for (const scene of input.scenes ?? createCanonicalPromoScenes()) {
      await captureScene(scene.scene, async () => {
        outputs.push(...await scene.execute(context))
      })
    }

    return outputs
  } finally {
    try {
      await electronApp.close()
    } catch {
      // Best effort only.
    }
  }
}

export function createCanonicalPromoScenes(): CanonicalPromoScene[] {
  return [
    {
      scene: 'app-shell',
      assets: [captureAsset('generated/overview-app-shell/01.png')],
      execute: async (context) => {
        await openCommandSurface(context.page)
        await context.seeded.sessions.workspaceClaude.row.click()
        await playwrightExpect(getVisibleTerminalViewport(context.page)).toBeVisible({ timeout: 15_000 })
        return await captureLocatorScreenshot(
          context.outputDir,
          context.page.getByTestId('app-viewport'),
          captureAsset('generated/overview-app-shell/01.png')
        )
      }
    },
    {
      scene: 'workspace-multi-session',
      assets: [captureAsset('generated/overview-workspace-multi-session/01.png')],
      execute: async (context) => {
        await openCommandSurface(context.page)
        return await captureLocatorScreenshot(
          context.outputDir,
          context.page.getByTestId('workspace-hierarchy-panel'),
          captureAsset('generated/overview-workspace-multi-session/01.png')
        )
      }
    },
    {
      scene: 'provider-mix',
      assets: [captureAsset('generated/overview-provider-mix/01.png')],
      execute: async (context) => {
        await openCommandSurface(context.page)
        return await captureLocatorScreenshot(
          context.outputDir,
          context.page.getByTestId('workspace-hierarchy-panel'),
          captureAsset('generated/overview-provider-mix/01.png')
        )
      }
    },
    {
      scene: 'settings-surface',
      assets: [captureAsset('generated/overview-settings-surface/01.png')],
      execute: async (context) => {
        await openSettingsSurface(context.page)
        return await captureLocatorScreenshot(
          context.outputDir,
          context.page.locator('[data-surface="settings"]'),
          captureAsset('generated/overview-settings-surface/01.png')
        )
      }
    },
    {
      scene: 'new-project-details',
      assets: [
        createAdHocAsset({
          relativePath: 'generated/workflow-new-project/01.png',
          note: 'Shows the real new-project flow with the modal filled and ready to submit.',
          alt: 'New project modal in Stoa with project name and path filled.',
          category: 'workflow',
          scene: 'new-project',
          tags: ['workflow', 'project', 'create', 'modal']
        }),
        createAdHocAsset({
          relativePath: 'generated/closeup-new-project-modal-filled/01.png',
          note: 'Close-up of the filled new-project modal.',
          alt: 'Filled Stoa new project modal.',
          category: 'closeup',
          scene: 'new-project-modal-filled',
          tags: ['closeup', 'project', 'modal']
        }),
        createAdHocAsset({
          relativePath: 'generated/closeup-new-project-path-picker/01.png',
          note: 'Close-up of the selected path inside the new-project flow.',
          alt: 'Selected path field in the Stoa new project modal.',
          category: 'closeup',
          scene: 'new-project-path-picker',
          tags: ['closeup', 'project', 'path']
        }),
        createAdHocAsset({
          relativePath: 'generated/closeup-new-project-submit-ready/01.png',
          note: 'Close-up of the new-project submit-ready state.',
          alt: 'Create button ready inside the Stoa new project modal.',
          category: 'closeup',
          scene: 'new-project-submit-ready',
          tags: ['closeup', 'project', 'submit']
        }),
        createAdHocAsset({
          relativePath: 'generated/workflow-project-create-to-visible/01.png',
          note: 'Shows that a project becomes visible in the workspace immediately after creation.',
          alt: 'Newly created project visible in the Stoa workspace list.',
          category: 'workflow',
          scene: 'project-create-to-visible',
          tags: ['workflow', 'project', 'visible']
        })
      ],
      execute: async (context) => {
        await openCommandSurface(context.page)
        const projectName = 'promo-inbox'
        const projectPath = join(context.stateDir, 'promo-inbox')
        await mkdir(projectPath, { recursive: true })
        await queueNextFolderPick(context.electronApp, projectPath)
        await context.page.getByTestId('workspace.new-project').click()

        const dialog = context.page.locator('[role="dialog"]').filter({
          has: context.page.getByTestId('new-project.submit')
        }).first()
        await playwrightExpect(dialog).toBeVisible({ timeout: 10_000 })
        await dialog.getByTestId('form-input').fill(projectName)
        await dialog.getByTestId('path-field').getByRole('button').click()
        await playwrightExpect(dialog.getByTestId('path-field').locator('input')).toHaveValue(projectPath)

        const outputs: CanonicalCaptureOutput[] = []
        outputs.push(...await captureLocatorScreenshot(
          context.outputDir,
          context.page.getByTestId('command-panel'),
          createAdHocAsset({
            relativePath: 'generated/workflow-new-project/01.png',
            note: 'Shows the real new-project flow with the modal filled and ready to submit.',
            alt: 'New project modal in Stoa with project name and path filled.',
            category: 'workflow',
            scene: 'new-project',
            tags: ['workflow', 'project', 'create', 'modal']
          })
        ))
        outputs.push(...await captureLocatorScreenshot(
          context.outputDir,
          dialog,
          createAdHocAsset({
            relativePath: 'generated/closeup-new-project-modal-filled/01.png',
            note: 'Close-up of the filled new-project modal.',
            alt: 'Filled Stoa new project modal.',
            category: 'closeup',
            scene: 'new-project-modal-filled',
            tags: ['closeup', 'project', 'modal']
          })
        ))
        outputs.push(...await captureLocatorScreenshot(
          context.outputDir,
          dialog.getByTestId('path-field'),
          createAdHocAsset({
            relativePath: 'generated/closeup-new-project-path-picker/01.png',
            note: 'Close-up of the selected path inside the new-project flow.',
            alt: 'Selected path field in the Stoa new project modal.',
            category: 'closeup',
            scene: 'new-project-path-picker',
            tags: ['closeup', 'project', 'path']
          })
        ))
        outputs.push(...await captureClipScreenshotAroundLocator(
          context.page,
          context.outputDir,
          dialog.getByTestId('new-project.submit'),
          { x: 160, y: 80 },
          createAdHocAsset({
            relativePath: 'generated/closeup-new-project-submit-ready/01.png',
            note: 'Close-up of the new-project submit-ready state.',
            alt: 'Create button ready inside the Stoa new project modal.',
            category: 'closeup',
            scene: 'new-project-submit-ready',
            tags: ['closeup', 'project', 'submit']
          })
        ))
        await dialog.getByTestId('new-project.submit').click()
        await playwrightExpect(context.page.locator(`[data-testid="project-row"][data-project-name="${projectName}"]`).first()).toBeVisible({ timeout: 15_000 })
        outputs.push(...await captureLocatorScreenshot(
          context.outputDir,
          context.page.getByTestId('workspace-hierarchy-panel'),
          createAdHocAsset({
            relativePath: 'generated/workflow-project-create-to-visible/01.png',
            note: 'Shows that a project becomes visible in the workspace immediately after creation.',
            alt: 'Newly created project visible in the Stoa workspace list.',
            category: 'workflow',
            scene: 'project-create-to-visible',
            tags: ['workflow', 'project', 'visible']
          })
        ))
        return outputs
      }
    },
    {
      scene: 'update-status-surface',
      assets: [captureAsset('generated/overview-update-status-surface/01.png')],
      execute: async (context) => {
        await openSettingsAboutTab(context.page)
        return await captureLocatorScreenshot(
          context.outputDir,
          context.page.locator('.settings-about__status-card').first(),
          captureAsset('generated/overview-update-status-surface/01.png')
        )
      }
    },
    {
      scene: 'terminal-live-output',
      assets: [captureAsset('generated/overview-terminal-live-output/01.png')],
      execute: async (context) => {
        await openCommandSurface(context.page)
        await context.seeded.sessions.workspaceClaude.row.click()
        await playwrightExpect(getVisibleTerminalViewport(context.page)).toBeVisible({ timeout: 15_000 })
        await appendTerminalReplay(context.electronApp, context.seeded.sessions.workspaceClaude.id, [
          '$ claude-code --resume workspace',
          'Restored 4 context anchors',
          'Scanning sessions...',
          'Ready for next instruction'
        ])
        return await captureLocatorScreenshot(
          context.outputDir,
          getVisibleTerminalViewport(context.page),
          captureAsset('generated/overview-terminal-live-output/01.png')
        )
      }
    },
    {
      scene: 'new-session-floating-entry',
      assets: [
        captureAsset('generated/workflow-new-session-floating-entry/01.png'),
        captureAsset('generated/closeup-provider-floating-card/01.png')
      ],
      execute: async (context) => {
        await openCommandSurface(context.page)
        const addButton = context.seeded.projects.workspace.row.locator('..').locator('[data-testid="workspace.add-session"]')
        await dispatchQuickAddSessionPress(addButton)
        await playwrightExpect(context.page.getByTestId('provider-card')).toBeVisible({ timeout: 10_000 })

        const outputs: CanonicalCaptureOutput[] = []
        outputs.push(...await captureLocatorScreenshot(
          context.outputDir,
          context.page.getByTestId('command-panel'),
          captureAsset('generated/workflow-new-session-floating-entry/01.png')
        ))
        outputs.push(...await captureLocatorScreenshot(
          context.outputDir,
          context.page.getByTestId('provider-card'),
          captureAsset('generated/closeup-provider-floating-card/01.png')
        ))
        await dismissOverlay(context.page)
        return outputs
      }
    },
    {
      scene: 'new-session-created',
      assets: [createAdHocAsset({
        relativePath: 'generated/workflow-new-session/01.png',
        note: 'Shows a newly created session appearing directly inside the workspace.',
        alt: 'A fresh session added to a Stoa project.',
        category: 'workflow',
        scene: 'new-session',
        tags: ['workflow', 'session', 'create']
      })],
      execute: async (context) => {
        await openCommandSurface(context.page)
        const labProjectRow = context.seeded.projects.lab.row
        const existingSessions = await context.page.getByTestId('session-row').count()
        await labProjectRow.click({ button: 'right' })
        await playwrightExpect(context.page.getByTestId('provider-card')).toBeVisible({ timeout: 10_000 })
        await context.page.locator('[data-testid="provider-card.item"][data-provider-type="shell"]').click()
        await playwrightExpect(context.page.getByTestId('session-row')).toHaveCount(existingSessions + 1, { timeout: 15_000 })
        return await captureLocatorScreenshot(
          context.outputDir,
          context.page.getByTestId('workspace-hierarchy-panel'),
          createAdHocAsset({
            relativePath: 'generated/workflow-new-session/01.png',
            note: 'Shows a newly created session appearing directly inside the workspace.',
            alt: 'A fresh session added to a Stoa project.',
            category: 'workflow',
            scene: 'new-session',
            tags: ['workflow', 'session', 'create']
          })
        )
      }
    },
    {
      scene: 'new-session-radial-entry',
      assets: [
        captureAsset('generated/workflow-new-session-radial-entry/01.png'),
        captureAsset('generated/closeup-provider-radial-menu/01.png')
      ],
      execute: async (context) => {
        await openCommandSurface(context.page)
        const addButton = context.seeded.projects.workspace.row.locator('..').locator('[data-testid="workspace.add-session"]')
        await openRadialMenu(addButton)
        await playwrightExpect(context.page.getByTestId('provider-radial.item').first()).toBeVisible({ timeout: 10_000 })

        const outputs: CanonicalCaptureOutput[] = []
        outputs.push(...await captureLocatorScreenshot(
          context.outputDir,
          context.page.getByTestId('command-panel'),
          captureAsset('generated/workflow-new-session-radial-entry/01.png')
        ))
        outputs.push(...await captureClipScreenshotAroundLocator(
          context.page,
          context.outputDir,
          addButton,
          { x: 140, y: 140 },
          captureAsset('generated/closeup-provider-radial-menu/01.png')
        ))
        await releaseRadialMenu(context.page)
        return outputs
      }
    },
    {
      scene: 'session-switching-and-active-indicator',
      assets: [
        createAdHocAsset({
          relativePath: 'generated/workflow-session-switching/01.png',
          note: 'Shows one session active in the workspace and terminal deck before switching.',
          alt: 'A Stoa workspace focused on one active session.',
          category: 'workflow',
          scene: 'session-switching-1',
          tags: ['workflow', 'session', 'switching']
        }),
        createAdHocAsset({
          relativePath: 'generated/workflow-session-switching/02.png',
          note: 'Shows a different session active after switching, preserving orientation.',
          alt: 'A Stoa workspace after switching to another active session.',
          category: 'workflow',
          scene: 'session-switching-2',
          tags: ['workflow', 'session', 'switching']
        }),
        createAdHocAsset({
          relativePath: 'generated/closeup-active-session-indicator/01.png',
          note: 'Close-up of the active session indicator in the workspace list.',
          alt: 'Active session indicator inside the Stoa workspace hierarchy.',
          category: 'closeup',
          scene: 'active-session-indicator',
          tags: ['closeup', 'session', 'active']
        })
      ],
      execute: async (context) => {
        await openCommandSurface(context.page)
        await context.seeded.sessions.workspaceClaude.row.click()
        const outputs: CanonicalCaptureOutput[] = []
        const activeIndicatorPreset = getWeakPromoCapturePreset('closeup-active-session-indicator')
        outputs.push(...await captureLocatorScreenshot(
          context.outputDir,
          context.page.getByTestId('command-panel'),
          createAdHocAsset({
            relativePath: 'generated/workflow-session-switching/01.png',
            note: 'Shows one session active in the workspace and terminal deck before switching.',
            alt: 'A Stoa workspace focused on one active session.',
            category: 'workflow',
            scene: 'session-switching-1',
            tags: ['workflow', 'session', 'switching']
          })
        ))
        outputs.push(...await captureClipScreenshotAroundLocator(
          context.page,
          context.outputDir,
          context.seeded.sessions.workspaceClaude.row.locator('..').first(),
          activeIndicatorPreset.padding ?? { x: 56, y: 28 },
          createAdHocAsset({
            relativePath: 'generated/closeup-active-session-indicator/01.png',
            note: 'Close-up of the active session indicator in the workspace list.',
            alt: 'Active session indicator inside the Stoa workspace hierarchy.',
            category: 'closeup',
            scene: 'active-session-indicator',
            tags: ['closeup', 'session', 'active']
          })
        ))
        await context.seeded.sessions.workspaceCodex.row.click()
        outputs.push(...await captureLocatorScreenshot(
          context.outputDir,
          context.page.getByTestId('command-panel'),
          createAdHocAsset({
            relativePath: 'generated/workflow-session-switching/02.png',
            note: 'Shows a different session active after switching, preserving orientation.',
            alt: 'A Stoa workspace after switching to another active session.',
            category: 'workflow',
            scene: 'session-switching-2',
            tags: ['workflow', 'session', 'switching']
          })
        ))
        return outputs
      }
    },
    {
      scene: 'session-maintenance-menu',
      assets: [
        captureAsset('generated/workflow-session-maintenance-menu/01.png'),
        captureAsset('generated/closeup-session-context-menu-restart/01.png')
      ],
      execute: async (context) => {
        await openCommandSurface(context.page)
        await context.seeded.sessions.workspaceCodex.row.click({ button: 'right' })
        const menu = context.page.getByTestId('session-context-menu')
        await playwrightExpect(menu).toBeVisible({ timeout: 10_000 })

        const outputs: CanonicalCaptureOutput[] = []
        outputs.push(...await captureLocatorScreenshot(
          context.outputDir,
          context.page.getByTestId('workspace-hierarchy-panel'),
          captureAsset('generated/workflow-session-maintenance-menu/01.png')
        ))
        outputs.push(...await captureLocatorScreenshot(
          context.outputDir,
          menu,
          captureAsset('generated/closeup-session-context-menu-restart/01.png')
        ))
        await dismissOverlay(context.page)
        return outputs
      }
    },
    {
      scene: 'project-delete-entry',
      assets: [
        createAdHocAsset({
          relativePath: 'generated/workflow-project-delete-entry/01.png',
          note: 'Shows the project-level delete entry inside the workspace row.',
          alt: 'Project delete entry visible on a Stoa workspace row.',
          category: 'workflow',
          scene: 'project-delete-entry',
          tags: ['workflow', 'project', 'delete']
        }),
        createAdHocAsset({
          relativePath: 'generated/workflow-project-delete/01.png',
          note: 'Shows project deletion as an explicit row-level maintenance action.',
          alt: 'Project row with a visible delete action in Stoa.',
          category: 'workflow',
          scene: 'project-delete',
          tags: ['workflow', 'project', 'delete']
        }),
        createAdHocAsset({
          relativePath: 'generated/closeup-project-delete-confirm/01.png',
          note: 'Close-up of the project delete affordance and its boundary in the row.',
          alt: 'Close-up of the Stoa project delete affordance.',
          category: 'closeup',
          scene: 'project-delete-confirm',
          tags: ['closeup', 'project', 'delete']
        })
      ],
      execute: async (context) => {
        await openCommandSurface(context.page)
        const labProject = context.seeded.projects.lab.row
        const wrapper = labProject.locator('..').first()
        const deletePreset = getWeakPromoCapturePreset('closeup-project-delete-confirm')
        if (deletePreset.hover) {
          await wrapper.hover()
        }
        const outputs: CanonicalCaptureOutput[] = []
        outputs.push(...await captureLocatorScreenshot(
          context.outputDir,
          wrapper,
          createAdHocAsset({
            relativePath: 'generated/workflow-project-delete-entry/01.png',
            note: 'Shows the project-level delete entry inside the workspace row.',
            alt: 'Project delete entry visible on a Stoa workspace row.',
            category: 'workflow',
            scene: 'project-delete-entry',
            tags: ['workflow', 'project', 'delete']
          })
        ))
        outputs.push(...await captureLocatorScreenshot(
          context.outputDir,
          context.page.getByTestId('workspace-hierarchy-panel'),
          createAdHocAsset({
            relativePath: 'generated/workflow-project-delete/01.png',
            note: 'Shows project deletion as an explicit row-level maintenance action.',
            alt: 'Project row with a visible delete action in Stoa.',
            category: 'workflow',
            scene: 'project-delete',
            tags: ['workflow', 'project', 'delete']
          })
        ))
        outputs.push(...await captureClipScreenshotAroundLocator(
          context.page,
          context.outputDir,
          wrapper,
          deletePreset.padding ?? { x: 44, y: 28 },
          createAdHocAsset({
            relativePath: 'generated/closeup-project-delete-confirm/01.png',
            note: 'Close-up of the project delete affordance and its boundary in the row.',
            alt: 'Close-up of the Stoa project delete affordance.',
            category: 'closeup',
            scene: 'project-delete-confirm',
            tags: ['closeup', 'project', 'delete']
          })
        ))
        return outputs
      }
    },
    {
      scene: 'workspace-archive-action',
      assets: [createAdHocAsset({
        relativePath: 'generated/closeup-workspace-archive-action/01.png',
        note: 'Close-up of the archive action revealed on a session row.',
        alt: 'Archive action visible on a Stoa session row.',
        category: 'closeup',
        scene: 'workspace-archive-action',
        tags: ['closeup', 'session', 'archive']
      })],
      execute: async (context) => {
        await openCommandSurface(context.page)
        const row = context.seeded.sessions.workspaceClaude.row.locator('..').first()
        await row.hover()
        return await captureLocatorScreenshot(
          context.outputDir,
          row,
          createAdHocAsset({
            relativePath: 'generated/closeup-workspace-archive-action/01.png',
            note: 'Close-up of the archive action revealed on a session row.',
            alt: 'Archive action visible on a Stoa session row.',
            category: 'closeup',
            scene: 'workspace-archive-action',
            tags: ['closeup', 'session', 'archive']
          })
        )
      }
    },
    {
      scene: 'session-archive-to-restore',
      assets: [
        captureAsset('generated/workflow-session-archive-to-restore/01.png'),
        captureAsset('generated/workflow-session-archive-to-restore/02.png')
      ],
      execute: async (context) => {
        await openArchiveSurface(context.page)
        const archivedRow = context.page.getByTestId('archive.session.row').first()
        const outputs: CanonicalCaptureOutput[] = []
        outputs.push(...await captureLocatorScreenshot(
          context.outputDir,
          context.page.getByTestId('surface.archive'),
          captureAsset('generated/workflow-session-archive-to-restore/01.png')
        ))
        await playwrightExpect(archivedRow).toBeVisible({ timeout: 10_000 })
        await context.page.getByTestId('archive.session.restore').first().click()
        await openCommandSurface(context.page)
        await playwrightExpect(context.seeded.sessions.archivedClaude.row).toBeVisible({ timeout: 15_000 })
        outputs.push(...await captureLocatorScreenshot(
          context.outputDir,
          context.page.getByTestId('command-panel'),
          captureAsset('generated/workflow-session-archive-to-restore/02.png')
        ))
        await context.page.locator(`[data-row-archive="${context.seeded.sessions.archivedClaude.id}"]`).click()
        return outputs
      }
    },
    {
      scene: 'session-status-lifecycle',
      assets: [
        captureAsset('generated/closeup-session-status-ready/01.png'),
        captureAsset('generated/closeup-session-status-running/01.png'),
        captureAsset('generated/closeup-session-status-blocked/01.png'),
        captureAsset('generated/closeup-session-status-complete/01.png'),
        captureAsset('generated/closeup-session-status-failure/01.png')
      ],
      execute: async (context) => {
        await openCommandSurface(context.page)
        const target = context.seeded.sessions.workspaceOpencode
        await target.row.click()
        await postCanonicalSessionEvent(context.electronApp, target, {
          eventType: 'session.started',
          payload: {
            intent: 'runtime.alive',
            runtimeState: 'alive',
            summary: 'Session running'
          }
        })

        const outputs: CanonicalCaptureOutput[] = []
        outputs.push(...await captureSessionRowScreenshot(
          context.outputDir,
          target.row,
          captureAsset('generated/closeup-session-status-ready/01.png')
        ))

        await postCanonicalSessionEvent(context.electronApp, target, {
          eventType: 'session.activity',
          payload: {
            intent: 'agent.turn_started',
            turnEpoch: 1,
            summary: 'Turn started'
          }
        })
        await expectSessionStatus(target.row, 'running')
        outputs.push(...await captureSessionRowScreenshot(
          context.outputDir,
          target.row,
          captureAsset('generated/closeup-session-status-running/01.png')
        ))

        await postCanonicalSessionEvent(context.electronApp, target, {
          eventType: 'session.blocked',
          payload: {
            intent: 'agent.permission_requested',
            turnEpoch: 1,
            blockingReason: 'permission',
            summary: 'Waiting for permission'
          }
        })
        await expectSessionStatus(target.row, 'blocked')
        outputs.push(...await captureSessionRowScreenshot(
          context.outputDir,
          target.row,
          captureAsset('generated/closeup-session-status-blocked/01.png')
        ))

        await postCanonicalSessionEvent(context.electronApp, target, {
          eventType: 'session.idle',
          payload: {
            intent: 'agent.turn_completed',
            turnEpoch: 1,
            summary: 'Turn complete'
          }
        })
        await expectSessionStatus(target.row, 'complete')
        outputs.push(...await captureSessionRowScreenshot(
          context.outputDir,
          target.row,
          captureAsset('generated/closeup-session-status-complete/01.png')
        ))

        await postRuntimeFailure(context.electronApp, target)
        await expectSessionStatus(target.row, 'failure')
        outputs.push(...await captureSessionRowScreenshot(
          context.outputDir,
          target.row,
          captureAsset('generated/closeup-session-status-failure/01.png')
        ))
        return outputs
      }
    },
    {
      scene: 'terminal-meta',
      assets: [
        createAdHocAsset({
          relativePath: 'generated/closeup-terminal-meta-bar/01.png',
          note: 'Close-up of the terminal meta bar around the active session.',
          alt: 'Terminal meta bar shown above an active session in Stoa.',
          category: 'closeup',
          scene: 'terminal-meta-bar',
          tags: ['closeup', 'terminal', 'meta']
        }),
        createAdHocAsset({
          relativePath: 'generated/closeup-terminal-meta-explanation/01.png',
          note: 'Shows the explanatory text inside the terminal meta bar when a session is blocked on permission.',
          alt: 'Terminal meta explanation showing a permission wait in Stoa.',
          category: 'closeup',
          scene: 'terminal-meta-explanation',
          tags: ['closeup', 'terminal', 'explanation']
        }),
        createAdHocAsset({
          relativePath: 'generated/closeup-session-status-permission-block/01.png',
          note: 'Shows a permission-blocked state with enough context to see that the session is waiting rather than dead.',
          alt: 'Permission-blocked session state in Stoa.',
          category: 'closeup',
          scene: 'session-status-permission-block',
          tags: ['closeup', 'status', 'permission', 'blocked']
        })
      ],
      execute: async (context) => {
        await openCommandSurface(context.page)
        const target = await createSessionViaUi(
          context.electronApp,
          context.page,
          context.seeded.projects.lab.row,
          'claude-code'
        )
        await target.row.click()
        const blockedHookRequest = createPermissionBlockedPromoHookRequest()
        await postClaudeHookEvent(context.electronApp, target, blockedHookRequest.body)
        const statusBar = context.page.getByTestId('terminal-status-bar')
        await playwrightExpect(statusBar).toBeVisible({ timeout: 15_000 })
        for (const text of blockedHookRequest.waitForTexts) {
          await playwrightExpect(statusBar).toContainText(text, { timeout: 15_000 })
        }
        await expectSessionStatus(target.row, 'blocked')

        const outputs: CanonicalCaptureOutput[] = []
        outputs.push(...await captureLocatorScreenshot(
          context.outputDir,
          statusBar,
          createAdHocAsset({
            relativePath: 'generated/closeup-terminal-meta-bar/01.png',
            note: 'Close-up of the terminal meta bar around the active session.',
            alt: 'Terminal meta bar shown above an active session in Stoa.',
            category: 'closeup',
            scene: 'terminal-meta-bar',
            tags: ['closeup', 'terminal', 'meta']
          })
        ))
        const metaExplanationPreset = getWeakPromoCapturePreset('closeup-terminal-meta-explanation')
        outputs.push(...await captureClipScreenshotAroundLocator(
          context.page,
          context.outputDir,
          statusBar,
          metaExplanationPreset.padding ?? { x: 18, y: 18 },
          createAdHocAsset({
            relativePath: 'generated/closeup-terminal-meta-explanation/01.png',
            note: 'Shows the explanatory text inside the terminal meta bar when a session is blocked on permission.',
            alt: 'Terminal meta explanation showing a permission wait in Stoa.',
            category: 'closeup',
            scene: 'terminal-meta-explanation',
            tags: ['closeup', 'terminal', 'explanation']
          })
        ))
        const permissionBlockPreset = getWeakPromoCapturePreset('closeup-session-status-permission-block')
        if (permissionBlockPreset.hover) {
          await target.row.locator('..').first().hover()
        }
        outputs.push(...await captureSessionRowScreenshot(
          context.outputDir,
          target.row,
          createAdHocAsset({
            relativePath: 'generated/closeup-session-status-permission-block/01.png',
            note: 'Shows a permission-blocked state with enough context to see that the session is waiting rather than dead.',
            alt: 'Permission-blocked session state in Stoa.',
            category: 'closeup',
            scene: 'session-status-permission-block',
            tags: ['closeup', 'status', 'permission', 'blocked']
          })
        ))
        return outputs
      }
    },
    {
      scene: 'meta-session-overview',
      assets: [captureAsset('generated/meta-meta-session-overview/01.png')],
      execute: async (context) => {
        await openMetaSessionSurface(context.page)
        return await captureLocatorScreenshot(
          context.outputDir,
          context.page.getByTestId('surface.meta-session'),
          captureAsset('generated/meta-meta-session-overview/01.png')
        )
      }
    },
    {
      scene: 'meta-session-create-flow',
      assets: [
        createAdHocAsset({
          relativePath: 'generated/meta-meta-session-create-flow/01.png',
          note: 'Shows the create-meta-session flow with the provider card open on the meta surface.',
          alt: 'Meta session create flow in Stoa with provider choices visible.',
          category: 'meta',
          scene: 'meta-session-create-flow-1',
          tags: ['meta', 'session', 'create']
        }),
        createAdHocAsset({
          relativePath: 'generated/meta-meta-session-create-flow/02.png',
          note: 'Shows the resulting meta session visible in the meta session list.',
          alt: 'A newly created meta session visible in Stoa.',
          category: 'meta',
          scene: 'meta-session-create-flow-2',
          tags: ['meta', 'session', 'create']
        })
      ],
      execute: async (context) => {
        await openMetaSessionSurface(context.page)
        await context.page.getByTestId('meta-session.session.create').click()
        await playwrightExpect(context.page.getByTestId('provider-card')).toBeVisible({ timeout: 10_000 })

        const outputs: CanonicalCaptureOutput[] = []
        outputs.push(...await captureLocatorScreenshot(
          context.outputDir,
          context.page.getByTestId('surface.meta-session'),
          createAdHocAsset({
            relativePath: 'generated/meta-meta-session-create-flow/01.png',
            note: 'Shows the create-meta-session flow with the provider card open on the meta surface.',
            alt: 'Meta session create flow in Stoa with provider choices visible.',
            category: 'meta',
            scene: 'meta-session-create-flow-1',
            tags: ['meta', 'session', 'create']
          })
        ))
        await context.page.locator('[data-testid="provider-card.item"][data-provider-type="opencode"]').click()
        await playwrightExpect(context.page.getByTestId('meta-session.session.item')).toHaveCount(2, { timeout: 15_000 })
        outputs.push(...await captureLocatorScreenshot(
          context.outputDir,
          context.page.getByTestId('meta-session-session-list'),
          createAdHocAsset({
            relativePath: 'generated/meta-meta-session-create-flow/02.png',
            note: 'Shows the resulting meta session visible in the meta session list.',
            alt: 'A newly created meta session visible in Stoa.',
            category: 'meta',
            scene: 'meta-session-create-flow-2',
            tags: ['meta', 'session', 'create']
          })
        ))
        return outputs
      }
    },
    {
      scene: 'meta-session-list-and-status',
      assets: [
        createAdHocAsset({
          relativePath: 'generated/meta-meta-session-list-and-inspector/01.png',
          note: 'Shows the meta session list and inspector together in one grounded UI shot.',
          alt: 'Meta session list and inspector visible together in Stoa.',
          category: 'meta',
          scene: 'meta-session-list-and-inspector',
          tags: ['meta', 'session', 'inspector']
        }),
        createAdHocAsset({
          relativePath: 'generated/meta-meta-session-status-chip/01.png',
          note: 'Close-up of the meta session status chip in the session list.',
          alt: 'Meta session status chip in Stoa.',
          category: 'meta',
          scene: 'meta-session-status-chip',
          tags: ['meta', 'session', 'status']
        })
      ],
      execute: async (context) => {
        await openMetaSessionSurface(context.page)
        const activeMetaRow = context.page.getByTestId('meta-session.session.item').first()
        const outputs: CanonicalCaptureOutput[] = []
        outputs.push(...await captureLocatorScreenshot(
          context.outputDir,
          context.page.getByTestId('surface.meta-session'),
          createAdHocAsset({
            relativePath: 'generated/meta-meta-session-list-and-inspector/01.png',
            note: 'Shows the meta session list and inspector together in one grounded UI shot.',
            alt: 'Meta session list and inspector visible together in Stoa.',
            category: 'meta',
            scene: 'meta-session-list-and-inspector',
            tags: ['meta', 'session', 'inspector']
          })
        ))
        outputs.push(...await captureClipScreenshotAroundLocator(
          context.page,
          context.outputDir,
          activeMetaRow,
          { x: 20, y: 12 },
          createAdHocAsset({
            relativePath: 'generated/meta-meta-session-status-chip/01.png',
            note: 'Close-up of the meta session status chip in the session list.',
            alt: 'Meta session status chip in Stoa.',
            category: 'meta',
            scene: 'meta-session-status-chip',
            tags: ['meta', 'session', 'status']
          })
        ))
        return outputs
      }
    },
    {
      scene: 'meta-session-archived-list',
      assets: [captureAsset('generated/meta-meta-session-archived-list/01.png')],
      execute: async (context) => {
        await openMetaSessionSurface(context.page)
        await openMetaArchivedSection(context.page)
        return await captureLocatorScreenshot(
          context.outputDir,
          context.page.getByTestId('meta-session-session-list'),
          captureAsset('generated/meta-meta-session-archived-list/01.png')
        )
      }
    },
    {
      scene: 'meta-session-restore-action',
      assets: [captureAsset('generated/meta-meta-session-restore-action/01.png')],
      execute: async (context) => {
        await openMetaSessionSurface(context.page)
        await openMetaArchivedSection(context.page)
        return await captureLocatorScreenshot(
          context.outputDir,
          context.page.getByTestId('meta-session.session.archived-item').first().locator('..'),
          captureAsset('generated/meta-meta-session-restore-action/01.png')
        )
      }
    },
    {
      scene: 'meta-session-action-panel',
      assets: [createAdHocAsset({
        relativePath: 'generated/meta-meta-session-action-panel/01.png',
        note: 'Shows the meta session action panel with a real proposal selected.',
        alt: 'Meta session action panel with an actionable proposal in Stoa.',
        category: 'meta',
        scene: 'meta-session-action-panel',
        tags: ['meta', 'session', 'action', 'proposal']
      })],
      execute: async (context) => {
        try {
          await createMetaPromptProposal({
            metaSessionId: context.seeded.meta.active.id,
            targetSessionId: context.seeded.sessions.workspaceClaude.id,
            text: 'Summarize the current attention queue before dispatch.'
          })
          await reloadPageAndWait(context.page)
        } catch {
          // The action panel itself remains truthful and useful even when proposal
          // seeding is unavailable in a given capture run.
        }
        await openMetaSessionSurface(context.page)
        const proposalItem = context.page.getByTestId('meta-session.proposal.item').first()
        if (await proposalItem.count() > 0) {
          await playwrightExpect(proposalItem).toBeVisible({ timeout: 15_000 })
          await proposalItem.click()
        }
        const panel = context.page.getByTestId('meta-session-action-panel')
        await playwrightExpect(panel).toBeVisible({ timeout: 15_000 })
        return await captureLocatorScreenshot(
          context.outputDir,
          context.page.getByTestId('meta-session-inspector-panel'),
          createAdHocAsset({
            relativePath: 'generated/meta-meta-session-action-panel/01.png',
            note: 'Shows the meta session action panel with a real proposal selected.',
            alt: 'Meta session action panel with an actionable proposal in Stoa.',
            category: 'meta',
            scene: 'meta-session-action-panel',
            tags: ['meta', 'session', 'action', 'proposal']
          })
        )
      }
    }
  ]
}

function captureAsset(relativePath: string): CaptureAsset {
  const asset = STABLE_CAPTURE_ASSET_MAP.get(relativePath)
  if (!asset) {
    throw new Error(`Unknown stable capture asset ${relativePath}`)
  }

  return {
    ...asset,
    tags: [...asset.tags],
    derivesFrom: [...asset.derivesFrom]
  }
}

async function seedCaptureContent(electronApp: ElectronApplication, page: Page): Promise<SeededCaptureContent> {
  const projectAPath = join(process.env.VIBECODING_STATE_DIR ?? await createTestTempDir('stoa-promo-workspace-'), 'promo-workspace')
  const projectBPath = join(process.env.VIBECODING_STATE_DIR ?? await createTestTempDir('stoa-promo-lab-'), 'promo-lab')

  const projectARow = await createProjectViaUi(electronApp, page, {
    name: 'promo-workspace',
    path: projectAPath
  })
  const projectBRow = await createProjectViaUi(electronApp, page, {
    name: 'promo-lab',
    path: projectBPath
  })

  const workspaceShell = await createSessionViaUi(electronApp, page, projectARow, 'shell')
  const workspaceOpencode = await createSessionViaUi(electronApp, page, projectARow, 'opencode')
  const workspaceCodex = await createSessionViaUi(electronApp, page, projectARow, 'codex')
  const workspaceClaude = await createSessionViaUi(electronApp, page, projectARow, 'claude-code')
  const archivedClaude = await createSessionViaUi(electronApp, page, projectBRow, 'claude-code')
  await archivedClaude.row.click()
  await page.locator(`[data-row-archive="${archivedClaude.id}"]`).click()

  await openMetaSessionSurface(page)
  const metaActive = await createMetaSessionViaUi(page, 'claude-code')
  const metaArchived = await createMetaSessionViaUi(page, 'codex')
  await page.locator(`[data-testid="meta-session.session.archive"][data-session-id="${metaArchived.id}"]`).click()
  await openCommandSurface(page)

  await playwrightExpect(page.getByTestId('project-row')).toHaveCount(2, { timeout: 15_000 })
  await playwrightExpect(page.getByTestId('session-row')).toHaveCount(4, { timeout: 15_000 })

  return {
    projects: {
      workspace: { row: projectARow, title: 'promo-workspace' },
      lab: { row: projectBRow, title: 'promo-lab' }
    },
    sessions: {
      workspaceShell,
      workspaceOpencode,
      workspaceCodex,
      workspaceClaude,
      archivedClaude
    },
    meta: {
      active: metaActive,
      archived: metaArchived
    }
  }
}

async function installFakeRuntimeProviders(page: Page, stateDir: string): Promise<void> {
  const fakeRuntimePath = join(stateDir, process.platform === 'win32' ? 'fake-runtime.cmd' : 'fake-runtime.sh')
  const script = process.platform === 'win32'
    ? '@echo off\r\nping -n 60 127.0.0.1 >nul\r\n'
    : '#!/bin/sh\nsleep 60\n'

  await writeFile(fakeRuntimePath, script, 'utf8')
  if (process.platform !== 'win32') {
    await chmod(fakeRuntimePath, 0o755)
  }

  await page.evaluate(async (providerPath) => {
    await window.stoa.setSetting('providers', {
      'claude-code': providerPath,
      codex: providerPath,
      opencode: providerPath
    })
  }, fakeRuntimePath)
}

async function queueNextFolderPick(electronApp: ElectronApplication, path: string | null): Promise<void> {
  await electronApp.evaluate(async (_electron, nextPath) => {
    const api = (globalThis as typeof globalThis & {
      __VIBECODING_MAIN_E2E__?: PromoMainE2EDebugApi
    }).__VIBECODING_MAIN_E2E__
    api?.queueDialogPickFolder(nextPath)
  }, path)
}

async function createProjectViaUi(
  electronApp: ElectronApplication,
  page: Page,
  options: { name: string; path: string }
): Promise<Locator> {
  await mkdir(options.path, { recursive: true })
  await queueNextFolderPick(electronApp, options.path)

  await page.getByTestId('workspace.new-project').click()

  const dialog = page.locator('[role="dialog"]').filter({
    has: page.getByTestId('new-project.submit')
  }).first()
  await playwrightExpect(dialog).toBeVisible({ timeout: 10_000 })
  await dialog.getByTestId('form-input').fill(options.name)
  await dialog.getByTestId('path-field').getByRole('button').click()
  await playwrightExpect(dialog.getByTestId('path-field').locator('input')).toHaveValue(options.path)
  await dialog.getByTestId('new-project.submit').click()

  const projectRow = page.locator(`[data-testid="project-row"][data-project-name="${options.name}"]`).first()
  await playwrightExpect(projectRow).toBeVisible({ timeout: 15_000 })
  return projectRow
}

async function createSessionViaUi(
  electronApp: ElectronApplication,
  page: Page,
  projectRow: Locator,
  type: 'shell' | 'opencode' | 'codex' | 'claude-code'
): Promise<SeededSessionHandle> {
  const debugStateBeforeCreate = await resolveDebugState(electronApp)
  const knownSessionIds = new Set(debugStateBeforeCreate.snapshot.sessions.map((session) => session.id))
  const existingSessions = await page.locator('[data-testid="session-row"]').count()
  await projectRow.click({ button: 'right' })
  const providerGroup = page.getByTestId('provider-card')
  await playwrightExpect(providerGroup).toBeVisible({ timeout: 10_000 })
  await providerGroup.locator(`[data-provider-type="${type}"]`).click()

  await playwrightExpect(page.getByTestId('session-row')).toHaveCount(existingSessions + 1, { timeout: 15_000 })
  const sessionRow = page.getByTestId('session-row').nth(existingSessions)
  await playwrightExpect(sessionRow).toBeVisible({ timeout: 15_000 })
  const title = await sessionRow.getAttribute('data-session-title') ?? `${type}-session`
  const debugSession = await resolveDebugSessionAfterCreate(electronApp, {
    knownSessionIds,
    title
  })
  if (type !== 'shell') {
    await waitForDebugSessionMatch(electronApp, debugSession.session.id, (session) => session.runtimeState === 'alive')
  }
  return {
    id: debugSession.session.id,
    projectId: debugSession.session.projectId,
    secret: debugSession.secret,
    row: page.locator(`[data-testid="session-row"][data-session-title="${title}"]`).first(),
    title
  }
}

async function createMetaSessionViaUi(
  page: Page,
  type: 'opencode' | 'codex' | 'claude-code'
): Promise<SeededMetaSessionHandle> {
  const existingRows = await page.getByTestId('meta-session.session.item').count()
  await page.getByTestId('meta-session.session.create').click()
  await playwrightExpect(page.getByTestId('provider-card')).toBeVisible({ timeout: 10_000 })
  await page.locator(`[data-testid="provider-card.item"][data-provider-type="${type}"]`).click()
  await playwrightExpect(page.getByTestId('meta-session.session.item')).toHaveCount(existingRows + 1, { timeout: 15_000 })
  const row = page.getByTestId('meta-session.session.item').nth(0)
  await playwrightExpect(row).toBeVisible({ timeout: 15_000 })
  const id = await row.getAttribute('data-session-id')
  const title = await row.locator('.route-session-title').first().textContent() ?? `meta-session-${existingRows + 1}`
  return {
    id: id ?? `meta-session-${existingRows + 1}`,
    row,
    title: title.trim()
  }
}

async function resolveDebugState(
  electronApp: ElectronApplication
): Promise<PromoMainE2EDebugState & { snapshot: NonNullable<PromoMainE2EDebugState['snapshot']>; webhookPort: number }> {
  const debugState = await electronApp.evaluate(async () => {
    const api = (globalThis as typeof globalThis & {
      __VIBECODING_MAIN_E2E__?: PromoMainE2EDebugApi
    }).__VIBECODING_MAIN_E2E__
    return api?.getDebugState() ?? null
  })

  if (!debugState?.snapshot || !debugState.webhookPort) {
    throw new Error('Promo capture debug state is unavailable.')
  }

  return debugState as PromoMainE2EDebugState & {
    snapshot: NonNullable<PromoMainE2EDebugState['snapshot']>
    webhookPort: number
  }
}

async function resolveDebugSessionByTitle(
  electronApp: ElectronApplication,
  title: string
): Promise<ResolvedDebugSession> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const debugState = await resolveDebugState(electronApp)
    const session = debugState.snapshot.sessions.find((candidate) => candidate.title === title)
    if (session) {
      return {
        session,
        secret: debugState.sessionSecrets[session.id] ?? null,
        webhookPort: debugState.webhookPort
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  throw new Error(`Timed out waiting for debug session ${title}`)
}

async function resolveDebugSessionAfterCreate(
  electronApp: ElectronApplication,
  input: {
    knownSessionIds: Set<string>
    title: string
  }
): Promise<ResolvedDebugSession> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const debugState = await resolveDebugState(electronApp)
    const session = resolveNewSessionDebugSnapshot({
      beforeIds: input.knownSessionIds,
      title: input.title,
      sessions: debugState.snapshot.sessions.map((candidate) => ({
        id: candidate.id,
        title: candidate.title
      }))
    })

    if (session) {
      return {
        session: debugState.snapshot.sessions.find((candidate) => candidate.id === session.id)!,
        secret: debugState.sessionSecrets[session.id] ?? null,
        webhookPort: debugState.webhookPort
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  throw new Error(`Timed out waiting for newly created debug session ${input.title}`)
}

async function waitForDebugSessionMatch(
  electronApp: ElectronApplication,
  sessionId: string,
  predicate: (session: PromoDebugSessionSnapshot) => boolean
): Promise<PromoDebugSessionSnapshot> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const debugState = await resolveDebugState(electronApp)
    const session = debugState.snapshot.sessions.find((candidate) => candidate.id === sessionId)
    if (session && predicate(session)) {
      return session
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  throw new Error(`Timed out waiting for session predicate ${sessionId}`)
}

async function appendTerminalReplay(
  electronApp: ElectronApplication,
  sessionId: string,
  lines: string[]
): Promise<void> {
  await electronApp.evaluate(async (_electron, payload) => {
    const api = (globalThis as typeof globalThis & {
      __VIBECODING_MAIN_E2E__?: PromoMainE2EDebugApi
    }).__VIBECODING_MAIN_E2E__
    await api?.appendTerminalData(payload.sessionId, payload.data)
  }, {
    sessionId,
    data: `${lines.join('\r\n')}\r\n`
  })
}

async function captureLocatorScreenshot(
  outputDir: string,
  locator: Locator,
  input: CaptureAsset
): Promise<CanonicalCaptureOutput[]> {
  const outputPath = join(outputDir, input.relativePath.replace(/^generated[\\/]/, ''))
  await mkdir(join(outputPath, '..'), { recursive: true })
  await playwrightExpect(locator).toBeVisible({ timeout: 15_000 })
  await locator.screenshot({ path: outputPath })
  return [{
    asset: {
      ...input,
      relativePath: input.relativePath.replaceAll('\\', '/')
    },
    absolutePath: outputPath
  }]
}

async function captureSessionRowScreenshot(
  outputDir: string,
  row: Locator,
  input: CaptureAsset
): Promise<CanonicalCaptureOutput[]> {
  const wrapper = row.locator('..').first()
  return await captureLocatorScreenshot(outputDir, wrapper, input)
}

async function captureClipScreenshotAroundLocator(
  page: Page,
  outputDir: string,
  locator: Locator,
  padding: { x: number; y: number },
  input: CaptureAsset
): Promise<CanonicalCaptureOutput[]> {
  const outputPath = join(outputDir, input.relativePath.replace(/^generated[\\/]/, ''))
  await mkdir(join(outputPath, '..'), { recursive: true })
  const box = await locator.boundingBox()
  if (!box) {
    throw new Error('Unable to resolve locator bounding box for clipped promo capture.')
  }

  const viewport = page.viewportSize() ?? { width: 1440, height: 1024 }
  const x = Math.max(0, box.x - padding.x)
  const y = Math.max(0, box.y - padding.y)
  const width = Math.min(viewport.width - x, box.width + padding.x * 2)
  const height = Math.min(viewport.height - y, box.height + padding.y * 2)

  await page.screenshot({
    path: outputPath,
    clip: {
      x,
      y,
      width,
      height
    }
  })
  return [{
    asset: {
      ...input,
      relativePath: input.relativePath.replaceAll('\\', '/')
    },
    absolutePath: outputPath
  }]
}

async function captureScene(
  scene: string,
  run: () => Promise<void>,
  cleanup?: () => Promise<void>
): Promise<void> {
  try {
    await run()
  } catch (error) {
    console.warn(`[promo][capture] scene failed: ${scene}`, error instanceof Error ? error.stack ?? error.message : String(error))
  } finally {
    if (cleanup) {
      try {
        await cleanup()
      } catch {
        // Best effort only.
      }
    }
  }
}

async function openCommandSurface(page: Page): Promise<void> {
  await page.locator('[data-activity-item="command"]').click()
  await playwrightExpect(page.getByTestId('command-panel')).toBeVisible({ timeout: 15_000 })
}

async function openSettingsSurface(page: Page): Promise<void> {
  await page.locator('[data-activity-item="settings"]').click()
  await playwrightExpect(page.locator('[data-surface="settings"]')).toBeVisible({ timeout: 15_000 })
}

async function openSettingsAboutTab(page: Page): Promise<void> {
  await openSettingsSurface(page)
  await page.locator('[data-settings-tab="about"]').click()
  await playwrightExpect(page.locator('#settings-panel-about')).toBeVisible({ timeout: 15_000 })
}

async function openArchiveSurface(page: Page): Promise<void> {
  await page.locator('[data-activity-item="archive"]').click()
  await playwrightExpect(page.getByTestId('surface.archive')).toBeVisible({ timeout: 15_000 })
}

async function openMetaSessionSurface(page: Page): Promise<void> {
  await page.locator('[data-activity-item="meta-session"]').click()
  await playwrightExpect(page.getByTestId('surface.meta-session')).toBeVisible({ timeout: 15_000 })
}

async function dismissOverlay(page: Page): Promise<void> {
  await page.mouse.click(24, 24)
}

async function openRadialMenu(addButton: Locator): Promise<void> {
  await addButton.dispatchEvent('mousedown')
  await new Promise((resolve) => setTimeout(resolve, LONG_PRESS_MS + 80))
}

async function releaseRadialMenu(page: Page): Promise<void> {
  await page.mouse.up()
  await dismissOverlay(page)
}

async function dispatchQuickAddSessionPress(addSessionButton: Locator): Promise<void> {
  await addSessionButton.dispatchEvent('mousedown')
  await new Promise((resolve) => setTimeout(resolve, 40))
  await addSessionButton.dispatchEvent('mouseup')
}

async function expectSessionStatus(row: Locator, status: 'ready' | 'running' | 'blocked' | 'complete' | 'failure'): Promise<void> {
  await playwrightExpect(row.locator('[data-testid="session-status-dot"]')).toHaveAttribute(
    'data-session-status-testid',
    `session-status-${status}`,
    { timeout: 15_000 }
  )
}

function getVisibleTerminalViewport(page: Page): Locator {
  return page.locator('[data-testid="terminal-viewport"]:visible').first()
}

async function postRuntimeFailure(
  electronApp: ElectronApplication,
  session: SeededSessionHandle
): Promise<void> {
  const debugState = await resolveDebugState(electronApp)
  const secret = session.secret ?? debugState.sessionSecrets[session.id]
  if (!secret || !debugState.webhookPort) {
    throw new Error(`Missing runtime secret for session ${session.id}`)
  }

  const response = await fetch(`http://127.0.0.1:${debugState.webhookPort}/events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-stoa-secret': secret
    },
    body: JSON.stringify({
      event_version: 1,
      event_id: `evt_${randomUUID()}`,
      event_type: 'runtime.exited_failed',
      timestamp: new Date().toISOString(),
      session_id: session.id,
      project_id: session.projectId,
      source: 'provider-adapter',
      payload: {
        intent: 'runtime.exited_failed',
        runtimeExitCode: 42,
        runtimeExitReason: 'failed',
        summary: 'Runtime failed'
      }
    })
  })

  if (response.status !== 202) {
    throw new Error(`Runtime failure event failed with status ${response.status}`)
  }
}

async function postCanonicalSessionEvent(
  electronApp: ElectronApplication,
  session: SeededSessionHandle,
  input: {
    eventType: string
    payload: Record<string, unknown>
  }
): Promise<void> {
  const debugState = await resolveDebugState(electronApp)
  const secret = session.secret ?? debugState.sessionSecrets[session.id]
  if (!secret || !debugState.webhookPort) {
    throw new Error(`Missing canonical event secret for session ${session.id}`)
  }

  const response = await fetch(`http://127.0.0.1:${debugState.webhookPort}/events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-stoa-secret': secret
    },
    body: JSON.stringify({
      event_version: 1,
      event_id: `evt_${randomUUID()}`,
      event_type: input.eventType,
      timestamp: new Date().toISOString(),
      session_id: session.id,
      project_id: session.projectId,
      source: 'provider-adapter',
      payload: input.payload
    })
  })

  if (response.status !== 202) {
    throw new Error(`Canonical event ${input.eventType} failed with status ${response.status}`)
  }
}

async function postClaudeHookEvent(
  electronApp: ElectronApplication,
  session: SeededSessionHandle,
  body: Record<string, unknown>
): Promise<void> {
  const debugState = await resolveDebugState(electronApp)
  const secret = session.secret ?? debugState.sessionSecrets[session.id]
  if (!secret || !debugState.webhookPort) {
    throw new Error(`Missing hook secret for session ${session.id}`)
  }

  const response = await fetch(`http://127.0.0.1:${debugState.webhookPort}/hooks/claude-code`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-stoa-secret': secret,
      'x-stoa-session-id': session.id,
      'x-stoa-project-id': session.projectId
    },
    body: JSON.stringify(body)
  })

  if (response.status !== 204) {
    throw new Error(`Claude hook request failed with status ${response.status}`)
  }
}

async function openMetaArchivedSection(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: /Archived/i }).first()
  await playwrightExpect(toggle).toBeVisible({ timeout: 10_000 })
  if (await page.getByTestId('meta-session.session.archived-item').count() === 0) {
    await toggle.click()
  }
  await playwrightExpect(page.getByTestId('meta-session.session.archived-item').first()).toBeVisible({ timeout: 10_000 })
}

export function toPromoAssetFromCapture(asset: CaptureAsset, absolutePath: string): PromoAsset {
  return {
    fileName: asset.relativePath.split('/').at(-1) ?? '01.png',
    relativePath: asset.relativePath.replaceAll('\\', '/'),
    absolutePath,
    pointId: asset.relativePath.split('/')[1] ?? asset.scene,
    note: asset.note,
    alt: asset.alt,
    category: asset.category,
    scene: asset.scene,
    kind: asset.kind,
    tags: [...asset.tags],
    source: asset.source,
    derivesFrom: [...asset.derivesFrom]
  }
}

function createAdHocAsset(input: {
  relativePath: string
  note: string
  alt: string
  category: PromoAssetCategory
  scene: string
  tags: string[]
  kind?: PromoAssetKind
  source?: PromoAssetSource
}): CaptureAsset {
  return {
    relativePath: input.relativePath,
    note: input.note,
    alt: input.alt,
    category: input.category,
    scene: input.scene,
    kind: input.kind ?? 'screenshot',
    tags: [...input.tags],
    source: input.source ?? 'electron-capture',
    derivesFrom: []
  }
}

async function createMetaPromptProposal(input: {
  metaSessionId: string
  targetSessionId: string
  text: string
}): Promise<void> {
  const portFile = await readPortFile()
  if (!portFile) {
    throw new Error('Meta session control port file is unavailable.')
  }

  const response = await fetch(`http://127.0.0.1:${portFile.port}/ctl/proposals`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-stoa-secret': portFile.secret,
      'x-stoa-session-id': input.metaSessionId
    },
    body: JSON.stringify({
      kind: 'prompt',
      targetSessionId: input.targetSessionId,
      text: input.text
    })
  })

  if (!response.ok) {
    throw new Error(`Failed to create meta proposal: ${response.status}`)
  }
}

async function reloadPageAndWait(page: Page): Promise<void> {
  await page.reload()
  await playwrightExpect(page.getByTestId('app-viewport')).toBeVisible({ timeout: 15_000 })
  await playwrightExpect(page.getByTestId('command-panel')).toBeVisible({ timeout: 15_000 })
}
