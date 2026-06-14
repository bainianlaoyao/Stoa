import { ref, type Ref } from 'vue'
import { getStoaClient, isStoaClientMode, requireRendererApi } from '@renderer/stores/stoa-store-plugin'

export interface InlineInput {
  parentPath: string
  type: 'file' | 'folder' | 'rename'
  depth: number
  existingName?: string
  existingPath?: string
}

export function useFileOperations(projectPath: Ref<string | null>, invalidatePath: (dirPath: string) => void) {
  const inlineInput = ref<InlineInput | null>(null)

  async function renameEntry(request: {
    projectPath: string
    oldRelativePath: string
    newRelativePath: string
  }): Promise<void> {
    if (isStoaClientMode()) {
      const client = getStoaClient()
      if (client) {
        await client.post('/api/v1/fs/rename', request)
        return
      }
    }

    await requireRendererApi().fsRename(request)
  }

  async function createEntry(request: {
    projectPath: string
    relativePath: string
    isDirectory: boolean
  }): Promise<void> {
    if (isStoaClientMode()) {
      const client = getStoaClient()
      if (client) {
        await client.post('/api/v1/fs/entry', request)
        return
      }
    }

    await requireRendererApi().fsCreate(request)
  }

  async function deleteFsEntry(request: {
    projectPath: string
    relativePath: string
  }): Promise<void> {
    if (isStoaClientMode()) {
      const client = getStoaClient()
      if (client) {
        await client.delete('/api/v1/fs/entry', request)
        return
      }
    }

    await requireRendererApi().fsDelete(request)
  }

  function startCreateFile(parentPath: string, depth: number): void {
    inlineInput.value = { parentPath, type: 'file', depth }
  }

  function startCreateFolder(parentPath: string, depth: number): void {
    inlineInput.value = { parentPath, type: 'folder', depth }
  }

  function startRename(existingPath: string, existingName: string, depth: number): void {
    inlineInput.value = {
      parentPath: existingPath.slice(0, existingPath.lastIndexOf('/')),
      type: 'rename',
      depth,
      existingName,
      existingPath,
    }
  }

  function cancelInput(): void {
    inlineInput.value = null
  }

  async function commitInput(name: string): Promise<void> {
    if (!projectPath.value || !inlineInput.value || !name.trim()) {
      inlineInput.value = null
      return
    }

    const input = inlineInput.value
    inlineInput.value = null

    try {
      if (input.type === 'rename' && input.existingPath) {
        const oldRel = input.existingPath.slice(projectPath.value.length + 1)
        const newRel = oldRel.slice(0, oldRel.lastIndexOf('/') + 1) + name
        await renameEntry({ projectPath: projectPath.value, oldRelativePath: oldRel, newRelativePath: newRel })
        invalidatePath(input.parentPath || projectPath.value)
      } else {
        const parentRel = input.parentPath ? input.parentPath.slice(projectPath.value.length + 1) : ''
        const relativePath = parentRel ? `${parentRel}/${name}` : name
        await createEntry({
          projectPath: projectPath.value,
          relativePath,
          isDirectory: input.type === 'folder',
        })
        invalidatePath(input.parentPath || projectPath.value)
      }
    } catch {
      // Error handled silently — user can retry
    }
  }

  async function deleteEntry(entryPath: string, parentDir: string): Promise<void> {
    if (!projectPath.value) return

    try {
      const relativePath = entryPath.slice(projectPath.value.length + 1)
      await deleteFsEntry({ projectPath: projectPath.value, relativePath })
      invalidatePath(parentDir || projectPath.value)
    } catch {
      // Error handled silently
    }
  }

  return {
    inlineInput,
    startCreateFile,
    startCreateFolder,
    startRename,
    cancelInput,
    commitInput,
    deleteEntry,
  }
}
