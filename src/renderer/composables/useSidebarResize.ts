import { ref, type Ref } from 'vue'

export interface PanelResizeOptions {
  containerRef: Ref<HTMLElement | null>
  currentWidth: Ref<number>
  minWidth: number
  maxWidth: number
  /** 'shrink-left' = dragging left makes panel wider (right sidebar).
   *  'grow-right'  = dragging right makes panel wider (left panel). */
  direction?: 'shrink-left' | 'grow-right'
  dynamicMaxWidth?: boolean
  minNonSidebarArea?: number
  onWidthChange: (width: number) => void
  onWidthCommit: () => void
}

export function usePanelResize(options: PanelResizeOptions): {
  onResizeStart: (e: MouseEvent) => void
} {
  const {
    containerRef,
    currentWidth,
    minWidth,
    maxWidth,
    direction = 'shrink-left',
    dynamicMaxWidth = false,
    minNonSidebarArea = 320,
    onWidthChange,
    onWidthCommit,
  } = options

  const isResizing = ref(false)

  // rAF throttle state — shared across drag sessions, reset on each start
  let rafPending = false
  let rafId: number | null = null
  let latestClientX = 0

  function onResizeStart(e: MouseEvent): void {
    e.preventDefault()
    isResizing.value = true

    const startX = e.clientX
    const startWidth = currentWidth.value

    // Reset rAF state for a fresh drag
    rafPending = false
    latestClientX = startX

    // Set body styles for drag feedback
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const overlay = document.createElement('div')
    overlay.style.position = 'fixed'
    overlay.style.inset = '0'
    overlay.style.zIndex = '9999'
    overlay.style.cursor = 'col-resize'
    document.body.appendChild(overlay)

    function stopDrag(): void {
      // Cancel any pending rAF
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
      rafPending = false

      overlay.removeEventListener('mousemove', onMouseMove)
      overlay.removeEventListener('mouseup', stopDrag)
      window.removeEventListener('blur', stopDrag)
      document.body.removeChild(overlay)

      // Restore body styles
      document.body.style.cursor = ''
      document.body.style.userSelect = ''

      // Read the final width from the DOM and commit to Pinia (triggers persistence)
      const container = containerRef.value
      if (container) {
        onWidthChange(container.offsetWidth)
      }
      isResizing.value = false
      onWidthCommit()
    }

    function onMouseMove(ev: MouseEvent): void {
      latestClientX = ev.clientX
      if (rafPending) return

      rafPending = true
      rafId = requestAnimationFrame(() => {
        rafPending = false
        rafId = null

        const computedMax = dynamicMaxWidth
          ? Math.max(minWidth, window.innerWidth - minNonSidebarArea)
          : maxWidth
        const rawDelta = latestClientX - startX
        const delta = direction === 'grow-right' ? rawDelta : -rawDelta
        const newWidth = Math.max(minWidth, Math.min(computedMax, startWidth + delta))

        // Write directly to DOM during drag — avoids reactive store churn
        const container = containerRef.value
        if (container) {
          container.style.width = `${newWidth}px`
        }
      })
    }

    overlay.addEventListener('mousemove', onMouseMove)
    overlay.addEventListener('mouseup', stopDrag)
    window.addEventListener('blur', stopDrag)
  }

  return { onResizeStart }
}

/** @deprecated Use usePanelResize instead */
export const useSidebarResize = usePanelResize
