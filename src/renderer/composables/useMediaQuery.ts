import { onBeforeUnmount, onMounted, shallowRef } from 'vue'

export function useMediaQuery(query: string) {
  const matches = shallowRef(false)
  let mediaQueryList: MediaQueryList | null = null

  function syncMatches(): void {
    matches.value = mediaQueryList?.matches ?? false
  }

  onMounted(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }

    mediaQueryList = window.matchMedia(query)
    syncMatches()
    mediaQueryList.addEventListener('change', syncMatches)
  })

  onBeforeUnmount(() => {
    mediaQueryList?.removeEventListener('change', syncMatches)
    mediaQueryList = null
  })

  return {
    matches
  }
}
