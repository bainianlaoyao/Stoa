import type { ExecutionCapability } from '@shared/memory-runtime'
import type { EvolverExecutionMode } from '@shared/project-session'

export interface ExecutionModeReader {
  getExecutionMode: () => EvolverExecutionMode
}

export type ExecutionCapabilityFactory = () => Promise<ExecutionCapability>

export class ExecutionRouter {
  constructor(
    private readonly settingsReader: ExecutionModeReader,
    private readonly factories: Record<EvolverExecutionMode, ExecutionCapabilityFactory>
  ) {}

  async resolve(): Promise<ExecutionCapability> {
    const mode = this.settingsReader.getExecutionMode()
    return await this.factories[mode]()
  }
}
