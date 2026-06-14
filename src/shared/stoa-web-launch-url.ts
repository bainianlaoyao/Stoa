export function buildStoaWebLaunchUrl(baseUrl: string, token: string): string {
  const url = new URL(baseUrl)
  url.hash = new URLSearchParams({ token }).toString()
  return url.toString()
}

export function readStoaWebTokenFromHash(hash: string): string | null {
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash
  const token = new URLSearchParams(fragment).get('token')?.trim()
  return token && token.length > 0 ? token : null
}
