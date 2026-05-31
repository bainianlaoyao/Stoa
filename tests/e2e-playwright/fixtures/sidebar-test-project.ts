import { execFile } from 'node:child_process'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createTestTempDir } from '../../../testing/test-temp'

export interface SidebarTestProject {
  projectPath: string
  cleanup: () => Promise<void>
}

const FILES: Record<string, string> = {
  'src/index.ts': "export const app = 'hello'",
  'src/utils.ts': 'export function add(a: number, b: number) { return a + b }\nexport function subtract(a: number, b: number) { return a - b }',
  'src/components/App.vue': '<template><div>App</div></template>',
  'src/components/Button.vue': '<template><button>Click</button></template>',
  'tests/app.test.ts': "import { describe, it } from 'vitest'\ndescribe('app', () => { it('works', () => {}) })",
  'package.json': '{\n  "name": "sidebar-test-project",\n  "version": "1.0.0"\n}',
  'README.md': '# Test Project\n\nTODO: update docs with more details',
  '.gitignore': 'node_modules\ndist\n.tmp\n',
}

function execGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@test.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@test.com' } }, (error, stdout) => {
      if (error) {
        reject(error)
      } else {
        resolve(stdout)
      }
    })
  })
}

export async function createSidebarTestProject(): Promise<SidebarTestProject> {
  const baseDir = await createTestTempDir('sidebar-project-')

  // Write all base files
  for (const [relativePath, content] of Object.entries(FILES)) {
    const fullPath = join(baseDir, relativePath)
    await mkdir(join(fullPath, '..'), { recursive: true })
    await writeFile(fullPath, content, 'utf-8')
  }

  // Init git and make initial commit
  await execGit(['init'], baseDir)
  await execGit(['add', '.'], baseDir)
  await execGit(['commit', '-m', 'Initial commit'], baseDir)

  // Pre-set staged file: new file added to index
  await writeFile(join(baseDir, 'staged-new.ts'), 'export const staged = true', 'utf-8')
  await execGit(['add', 'staged-new.ts'], baseDir)

  // Pre-set modified (unstaged) file: tracked but modified in working tree
  await writeFile(join(baseDir, 'README.md'), '# Test Project\n\nMODIFIED: this line was changed\nTODO: update docs with more details', 'utf-8')

  // Pre-set untracked file
  await writeFile(join(baseDir, 'untracked.txt'), 'I am untracked', 'utf-8')

  return {
    projectPath: baseDir,
    async cleanup() {
      for (let attempt = 1; attempt <= 10; attempt++) {
        try {
          await rm(baseDir, { recursive: true, force: true })
          return
        } catch {
          if (attempt === 10) return
          await new Promise(r => setTimeout(r, 200 * attempt))
        }
      }
    },
  }
}
