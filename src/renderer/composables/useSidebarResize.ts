import { ref, type Ref } from 'vue'

const MIN_WIDTH = 220
const MIN_NON_SIDEBAR_AREA = 320

export function useSidebarResize(
  containerRef: Ref<HTMLElement | null>,
  currentWidth: Ref<number>,
  onWidthChange: (width: number) => void,
  onWidthCommit: () => void,
): { onResizeStart: (e: MouseEvent) => void } {
  const isResizing = ref(false)

  function onResizeStart(e: MouseEvent): void {
    e.preventDefault()
    isResizing.value = true

    const startX = e.clientX
    const startWidth = currentWidth.value

    const overlay = document.createElement('div')
    overlay.style.position = 'fixed'
    overlay.style.inset = '0'
    overlay.style.zIndex = '9999'
    overlay.style.cursor = 'col-resize'
    document.body.appendChild(overlay)

    function onMouseMove(e: MouseEvent): void {
      const maxWidth = Math.max(MIN_WIDTH, window.innerWidth - MIN_NON_SIDEBAR_AREA)
      const delta = startX - e.clientX
      const newWidth = Math.max(MIN_WIDTH, Math.min(maxWidth, startWidth + delta))
      onWidthChange(newWidth)
    }

    function onMouseUp(): void {
      overlay.removeEventListener('mousemove', onMouseMove)
      overlay.removeEventListener('mouseup', onMouseUp)
      document.body.removeChild(overlay)
      isResizing.value = false
      onWidthCommit()
    }

    overlay.addEventListener('mousemove', onMouseMove)
    overlay.addEventListener('mouseup', onMouseUp)
  }

  return { onResizeStart }
}
