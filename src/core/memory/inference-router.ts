import type { InferenceCapability } from '@shared/memory-runtime'
import type { EvolverInferenceProvider } from '@shared/project-session'

export interface InferenceProviderReader {
  getInferenceProvider: () => EvolverInferenceProvider
}

export type InferenceCapabilityFactory = () => Promise<InferenceCapability>

export class InferenceRouter {
  constructor(
    private readonly settingsReader: InferenceProviderReader,
    private readonly factories: Record<EvolverInferenceProvider, InferenceCapabilityFactory>
  ) {}

  async resolve(): Promise<InferenceCapability> {
    const provider = this.settingsReader.getInferenceProvider()
    return await this.factories[provider]()
  }
}
