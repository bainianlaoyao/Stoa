/**
 * Pinia plugin that provides the StoaClient instance to all stores.
 *
 * Stores can access the client via `this.$stoaClient` when StoaClient
 * mode is active (VITE_USE_STOA_CLIENT=1).
 *
 * When the feature flag is off, `$stoaClient` is null and stores
 * fall through to the legacy IPC path (window.stoa).
 */

import type { PiniaPluginContext } from 'pinia'
import { StoaClient } from '@renderer/lib/stoa-client'

// Augment Pinia store properties
declare module 'pinia' {
  export interface PiniaCustomProperties {
    /** StoaClient instance, or null when using legacy IPC mode */
    $stoaClient: StoaClient | null
  }
}

let clientInstance: StoaClient | null = null

/**
 * Initialize the global StoaClient instance.
 * Call once during app bootstrap before creating Pinia stores.
 */
export function initStoaClientForStores(baseUrl: string, token: string): StoaClient {
  clientInstance = new StoaClient(baseUrl, token)
  return clientInstance
}

/**
 * Get the current StoaClient instance (null if not initialized or not in StoaClient mode).
 */
export function getStoaClient(): StoaClient | null {
  return clientInstance
}

/**
 * Check if StoaClient mode is enabled via feature flag.
 */
export function isStoaClientMode(): boolean {
  if (typeof import.meta === 'undefined') return false
  return import.meta.env.VITE_USE_STOA_CLIENT === '1'
    || import.meta.env.VITE_USE_STOA_CLIENT === 'true'
}

/**
 * Pinia plugin that injects `$stoaClient` into every store.
 */
export function stoaClientPlugin() {
  return ({ store }: PiniaPluginContext) => {
    store.$stoaClient = clientInstance
  }
}
