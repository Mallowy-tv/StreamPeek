import { createEmbedFallback } from '../player/embed-fallback'
import { createPreviewPlayer } from '../player/preview-player'
import type { PreviewRenderable, TwitchCardTarget } from '../shared/types'

const HOVER_DELAY_MS = 350
const LEAVE_DELAY_MS = 140
const SIDE_NAV_LEAVE_DELAY_MS = 500
const SIDE_NAV_PREVIEW_GAP_PX = 12
const SIDE_NAV_PREVIEW_MAX_WIDTH_PX = 360
const SIDE_NAV_PREVIEW_MIN_WIDTH_PX = 260
const VIEWPORT_PADDING_PX = 12

interface CardBinding {
  card: TwitchCardTarget
  enterHandler: () => void
  floatingEnterHandler: (() => void) | null
  floatingLeaveHandler: (() => void) | null
  isSideNavTooltipSuppressed: boolean
  leaveHandler: () => void
  hoverTimeoutId: number | null
  leaveTimeoutId: number | null
  activationToken: number
  overlayRoot: HTMLDivElement | null
  renderable: PreviewRenderable | null
}

function clearTimer(timerId: number | null) {
  if (timerId !== null) {
    window.clearTimeout(timerId)
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function getLeaveDelayMs(surface: TwitchCardTarget['surface']): number {
  return surface === 'side-nav-card' ? SIDE_NAV_LEAVE_DELAY_MS : LEAVE_DELAY_MS
}

function readTwitchAuthToken(): string | undefined {
  const authCookie = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith('auth-token='))

  if (!authCookie) {
    return undefined
  }

  const value = authCookie.slice('auth-token='.length).trim()

  return value.length > 0 ? decodeURIComponent(value) : undefined
}

function buildLoadingState(channel: string): HTMLDivElement {
  const loadingRoot = document.createElement('div')
  loadingRoot.className = 'streampeek-loading-shell'

  const badge = document.createElement('div')
  badge.className = 'streampeek-badge'
  badge.textContent = 'StreamPeek'

  const text = document.createElement('div')
  text.className = 'streampeek-loading'
  text.textContent = `Connecting to ${channel}...`

  loadingRoot.append(badge, text)

  return loadingRoot
}

function buildSideNavHeader(binding: CardBinding): HTMLDivElement {
  const title = binding.card.title.trim() || binding.card.channel
  const header = document.createElement('div')
  header.className = 'streampeek-side-nav-header'

  const titleLink = document.createElement('a')
  titleLink.className = 'streampeek-side-nav-title-link'
  titleLink.href = binding.card.anchor.href
  titleLink.setAttribute('aria-label', title)

  const marquee = document.createElement('span')
  marquee.className = 'streampeek-side-nav-title-marquee'
  marquee.setAttribute('aria-hidden', 'true')

  const firstCopy = document.createElement('span')
  firstCopy.className = 'streampeek-side-nav-title-copy'
  firstCopy.textContent = title

  const secondCopy = document.createElement('span')
  secondCopy.className = 'streampeek-side-nav-title-copy'
  secondCopy.textContent = title

  marquee.append(firstCopy, secondCopy)
  titleLink.append(marquee)
  header.append(titleLink)

  return header
}

function wrapSideNavRenderable(binding: CardBinding, content: HTMLElement): HTMLDivElement {
  const shell = document.createElement('div')
  shell.className = 'streampeek-side-nav-shell'

  const body = document.createElement('div')
  body.className = 'streampeek-side-nav-body'
  body.append(content)

  shell.append(buildSideNavHeader(binding), body)

  return shell
}

function markSideNavTooltipNodes() {
  const tooltipBodies = document.querySelectorAll<HTMLElement>('.online-side-nav-channel-tooltip__body')

  for (const tooltipBody of tooltipBodies) {
    tooltipBody.dataset.streampeekHiddenSideNavTooltip = 'true'
    tooltipBody.closest<HTMLElement>('.tw-balloon')?.setAttribute('data-streampeek-hidden-side-nav-tooltip', 'true')
    tooltipBody.closest<HTMLElement>('.tw-transition')?.setAttribute('data-streampeek-hidden-side-nav-tooltip', 'true')
    tooltipBody
      .closest<HTMLElement>('[data-popper-placement]')
      ?.setAttribute('data-streampeek-hidden-side-nav-tooltip', 'true')
  }
}

function clearMarkedSideNavTooltipNodes() {
  const hiddenNodes = document.querySelectorAll<HTMLElement>('[data-streampeek-hidden-side-nav-tooltip]')

  for (const node of hiddenNodes) {
    delete node.dataset.streampeekHiddenSideNavTooltip
  }
}

function setSideNavTooltipSuppressed(isSuppressed: boolean, observer: MutationObserver | null) {
  if (isSuppressed) {
    document.body.dataset.streampeekSideNavPreview = 'active'
    markSideNavTooltipNodes()
    observer?.observe(document.body, {
      childList: true,
      subtree: true,
    })
    return
  }

  observer?.disconnect()
  clearMarkedSideNavTooltipNodes()
  delete document.body.dataset.streampeekSideNavPreview
}

function updateSideNavPreviewPosition(binding: CardBinding) {
  if (binding.card.surface !== 'side-nav-card' || !binding.overlayRoot) {
    return
  }

  const anchorRect = binding.card.anchor.getBoundingClientRect()
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const maxViewportWidth = Math.max(0, viewportWidth - VIEWPORT_PADDING_PX * 2)
  const previewWidth = clamp(
    Math.min(SIDE_NAV_PREVIEW_MAX_WIDTH_PX, maxViewportWidth),
    Math.min(SIDE_NAV_PREVIEW_MIN_WIDTH_PX, maxViewportWidth),
    Math.max(SIDE_NAV_PREVIEW_MIN_WIDTH_PX, maxViewportWidth),
  )
  const previewHeight = Math.round((previewWidth * 9) / 16)

  let left = anchorRect.right + SIDE_NAV_PREVIEW_GAP_PX

  if (left + previewWidth > viewportWidth - VIEWPORT_PADDING_PX) {
    left = anchorRect.left - SIDE_NAV_PREVIEW_GAP_PX - previewWidth
  }

  left = clamp(left, VIEWPORT_PADDING_PX, viewportWidth - previewWidth - VIEWPORT_PADDING_PX)

  const centeredTop = anchorRect.top + anchorRect.height / 2 - previewHeight / 2
  const top = clamp(
    centeredTop,
    VIEWPORT_PADDING_PX,
    viewportHeight - previewHeight - VIEWPORT_PADDING_PX,
  )

  Object.assign(binding.overlayRoot.style, {
    height: `${previewHeight}px`,
    left: `${left}px`,
    top: `${top}px`,
    width: `${previewWidth}px`,
  })
}

function ensureOverlayRoot(binding: CardBinding, deactivate: (binding: CardBinding) => void): HTMLDivElement {
  if (binding.overlayRoot) {
    return binding.overlayRoot
  }

  binding.card.anchor.dataset.streampeekActive = 'true'

  const overlayRoot = document.createElement('div')

  if (binding.card.surface === 'side-nav-card') {
    overlayRoot.className = 'streampeek-hover-root streampeek-hover-root--side-nav'

    binding.floatingEnterHandler = () => {
      clearTimer(binding.leaveTimeoutId)
      binding.leaveTimeoutId = null
    }

      binding.floatingLeaveHandler = () => {
        clearTimer(binding.hoverTimeoutId)
        binding.hoverTimeoutId = null
        clearTimer(binding.leaveTimeoutId)
        binding.leaveTimeoutId = window.setTimeout(() => {
          binding.leaveTimeoutId = null
          deactivate(binding)
        }, getLeaveDelayMs(binding.card.surface))
      }

    overlayRoot.addEventListener('mouseenter', binding.floatingEnterHandler)
    overlayRoot.addEventListener('mouseleave', binding.floatingLeaveHandler)
    document.body.append(overlayRoot)
    updateSideNavPreviewPosition(binding)
  } else {
    overlayRoot.className = 'streampeek-hover-root'
    binding.card.anchor.classList.add('streampeek-preview-anchor')
    binding.card.anchor.append(overlayRoot)
  }

  binding.overlayRoot = overlayRoot
  return overlayRoot
}

export function createHoverController() {
  const bindings = new Map<HTMLAnchorElement, CardBinding>()
  let activeBinding: CardBinding | null = null
  let sideNavTooltipSuppressionCount = 0
  const sideNavTooltipObserver = new MutationObserver(() => {
    markSideNavTooltipNodes()
  })

  const syncSideNavTooltipSuppression = () => {
    setSideNavTooltipSuppressed(sideNavTooltipSuppressionCount > 0, sideNavTooltipObserver)
  }

  const setBindingSideNavTooltipSuppressed = (binding: CardBinding, isSuppressed: boolean) => {
    if (binding.card.surface !== 'side-nav-card' || binding.isSideNavTooltipSuppressed === isSuppressed) {
      return
    }

    binding.isSideNavTooltipSuppressed = isSuppressed
    sideNavTooltipSuppressionCount += isSuppressed ? 1 : -1
    syncSideNavTooltipSuppression()
  }

  const clearRenderable = (binding: CardBinding) => {
    binding.renderable?.dispose()
    binding.renderable = null
  }

  const cleanupOverlayDom = (binding: CardBinding) => {
    binding.card.anchor.dataset.streampeekActive = 'false'
    binding.card.anchor.classList.remove('streampeek-preview-anchor')

    if (binding.overlayRoot && binding.floatingEnterHandler) {
      binding.overlayRoot.removeEventListener('mouseenter', binding.floatingEnterHandler)
    }

    if (binding.overlayRoot && binding.floatingLeaveHandler) {
      binding.overlayRoot.removeEventListener('mouseleave', binding.floatingLeaveHandler)
    }

    binding.overlayRoot?.remove()
    binding.overlayRoot = null
    binding.floatingEnterHandler = null
    binding.floatingLeaveHandler = null
    setBindingSideNavTooltipSuppressed(binding, false)
  }

  const resetOverlay = (binding: CardBinding) => {
    clearRenderable(binding)
    cleanupOverlayDom(binding)
  }

  const deactivate = (binding: CardBinding) => {
    clearTimer(binding.hoverTimeoutId)
    clearTimer(binding.leaveTimeoutId)
    binding.hoverTimeoutId = null
    binding.leaveTimeoutId = null
    binding.activationToken += 1

    if (activeBinding === binding) {
      activeBinding = null
    }

    resetOverlay(binding)
  }

  const mountRenderable = (binding: CardBinding, renderable: PreviewRenderable) => {
    const overlayRoot = ensureOverlayRoot(binding, deactivate)
    updateSideNavPreviewPosition(binding)
    overlayRoot.replaceChildren(
      binding.card.surface === 'side-nav-card'
        ? wrapSideNavRenderable(binding, renderable.element)
        : renderable.element,
    )
    binding.renderable = renderable
  }

  const mountFallback = (binding: CardBinding) => {
    clearRenderable(binding)
    mountRenderable(
      binding,
      createEmbedFallback({
        channel: binding.card.channel,
      }),
    )
  }

  const activate = (binding: CardBinding) => {
    if (activeBinding && activeBinding !== binding) {
      deactivate(activeBinding)
    }

    activeBinding = binding
    binding.card.anchor.dataset.streampeekActive = 'true'

    const activationToken = binding.activationToken + 1
    binding.activationToken = activationToken

    const overlayRoot = ensureOverlayRoot(binding, deactivate)
    updateSideNavPreviewPosition(binding)
    overlayRoot.replaceChildren(buildLoadingState(binding.card.channel))
    clearRenderable(binding)

    mountRenderable(
      binding,
      createPreviewPlayer({
        authToken: readTwitchAuthToken(),
        channel: binding.card.channel,
        title: binding.card.title,
        onFatalError: () => {
          if (binding.activationToken !== activationToken || activeBinding !== binding) {
            return
          }

          mountFallback(binding)
        },
      }),
    )
  }

  const registerCard = (card: TwitchCardTarget) => {
    if (bindings.has(card.anchor)) {
      return
    }

    const binding: CardBinding = {
      activationToken: 0,
      card,
      enterHandler: () => {
        clearTimer(binding.leaveTimeoutId)
        binding.leaveTimeoutId = null
        setBindingSideNavTooltipSuppressed(binding, true)

        if (activeBinding === binding) {
          return
        }

        clearTimer(binding.hoverTimeoutId)
        binding.hoverTimeoutId = window.setTimeout(() => {
          binding.hoverTimeoutId = null
          activate(binding)
        }, HOVER_DELAY_MS)
      },
      floatingEnterHandler: null,
      floatingLeaveHandler: null,
      hoverTimeoutId: null,
      isSideNavTooltipSuppressed: false,
      leaveHandler: () => {
        clearTimer(binding.hoverTimeoutId)
        binding.hoverTimeoutId = null
        clearTimer(binding.leaveTimeoutId)

        binding.leaveTimeoutId = window.setTimeout(() => {
          binding.leaveTimeoutId = null
          deactivate(binding)
        }, getLeaveDelayMs(binding.card.surface))
      },
      leaveTimeoutId: null,
      overlayRoot: null,
      renderable: null,
    }

    card.anchor.addEventListener('mouseenter', binding.enterHandler)
    card.anchor.addEventListener('mouseleave', binding.leaveHandler)
    bindings.set(card.anchor, binding)
  }

  const unregisterCard = (anchor: HTMLAnchorElement) => {
    const binding = bindings.get(anchor)

    if (!binding) {
      return
    }

    cardCleanup(binding)
    bindings.delete(anchor)
  }

  const cardCleanup = (binding: CardBinding) => {
    binding.card.anchor.removeEventListener('mouseenter', binding.enterHandler)
    binding.card.anchor.removeEventListener('mouseleave', binding.leaveHandler)
    deactivate(binding)
    delete binding.card.anchor.dataset.streampeekActive
  }

  const syncActiveOverlayPosition = () => {
    if (!activeBinding || activeBinding.card.surface !== 'side-nav-card' || !activeBinding.overlayRoot) {
      return
    }

    if (!activeBinding.card.anchor.isConnected) {
      deactivate(activeBinding)
      return
    }

    updateSideNavPreviewPosition(activeBinding)
  }

  window.addEventListener('resize', syncActiveOverlayPosition)
  window.addEventListener('scroll', syncActiveOverlayPosition, true)

  return {
    destroy: () => {
      window.removeEventListener('resize', syncActiveOverlayPosition)
      window.removeEventListener('scroll', syncActiveOverlayPosition, true)
      sideNavTooltipObserver.disconnect()
      clearMarkedSideNavTooltipNodes()
      delete document.body.dataset.streampeekSideNavPreview

      for (const binding of bindings.values()) {
        cardCleanup(binding)
      }

      bindings.clear()
      activeBinding = null
    },
    registerCard,
    unregisterCard,
  }
}
