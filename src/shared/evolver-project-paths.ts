import { join } from 'node:path'

export interface EvolverProjectPaths {
  repoRoot: string
  projectRoot: string
  memoryDir: string
  evolutionDir: string
  gepAssetsDir: string
  memoryGraphPath: string
}

export function resolveEvolverProjectPaths(projectRoot: string, repoRoot: string): EvolverProjectPaths {
  const memoryDir = join(projectRoot, '.stoa', 'memory', 'evolver', 'memory')
  const evolutionDir = join(projectRoot, '.stoa', 'memory', 'evolver', 'evolution')
  const gepAssetsDir = join(projectRoot, '.stoa', 'memory', 'evolver', 'assets', 'gep')

  return {
    repoRoot,
    projectRoot,
    memoryDir,
    evolutionDir,
    gepAssetsDir,
    memoryGraphPath: join(evolutionDir, 'memory_graph.jsonl')
  }
}

export function buildEvolverProjectEnv(
  paths: EvolverProjectPaths,
  baseEnv: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    EVOLVER_ROOT: paths.repoRoot,
    EVOLVER_REPO_ROOT: paths.projectRoot,
    MEMORY_DIR: paths.memoryDir,
    EVOLUTION_DIR: paths.evolutionDir,
    GEP_ASSETS_DIR: paths.gepAssetsDir,
    MEMORY_GRAPH_PATH: paths.memoryGraphPath,
    EVOLVER_QUIET_PARENT_GIT: '1'
  }
}
