import type { TwitchCardTarget, TwitchHoverSurface } from '../shared/types'

const DIRECTORY_CARD_SELECTOR = 'a[data-a-target="preview-card-image-link"][href^="/"]'
const SIDE_NAV_CARD_SELECTOR = 'a.side-nav-card__link[href^="/"]'
const CARD_SELECTOR = `${DIRECTORY_CARD_SELECTOR}, ${SIDE_NAV_CARD_SELECTOR}`

interface ObserveTwitchCardsOptions {
  onCardFound: (card: TwitchCardTarget) => void
  onCardRemoved: (card: TwitchCardTarget) => void
}

function extractChannel(href: string): string | null {
  const trimmed = href.trim()

  if (!trimmed.startsWith('/')) {
    return null
  }

  const channel = trimmed.slice(1).split('/')[0]

  return channel.length > 0 ? channel : null
}

function detectSurface(anchor: HTMLAnchorElement): TwitchHoverSurface | null {
  if (anchor.matches(DIRECTORY_CARD_SELECTOR)) {
    return 'directory-card'
  }

  if (anchor.matches(SIDE_NAV_CARD_SELECTOR)) {
    return 'side-nav-card'
  }

  return null
}

function readTitle(anchor: HTMLAnchorElement, surface: TwitchHoverSurface): string {
  if (surface === 'side-nav-card') {
    const sideNavTitle = anchor.querySelector<HTMLElement>('[data-a-target="side-nav-title"]')
      ?.textContent
      ?.trim()

    if (sideNavTitle) {
      return sideNavTitle
    }
  }

  const image = anchor.querySelector('img[alt]')

  if (image instanceof HTMLImageElement && image.alt.trim().length > 0) {
    return image.alt.trim()
  }

  return anchor.getAttribute('aria-label')?.trim() || anchor.href
}

function isLiveSideNavCard(anchor: HTMLAnchorElement): boolean {
  return anchor.querySelector('[data-a-target="side-nav-live-status"]') !== null
}

export function observeTwitchCards(options: ObserveTwitchCardsOptions): () => void {
  const trackedCards = new Map<HTMLAnchorElement, TwitchCardTarget>()
  let animationFrameId = 0

  const scan = () => {
    animationFrameId = 0

    const seenAnchors = new Set<HTMLAnchorElement>()
    const anchors = document.querySelectorAll<HTMLAnchorElement>(CARD_SELECTOR)

    for (const anchor of anchors) {
      const surface = detectSurface(anchor)

      if (!surface) {
        continue
      }

      if (surface === 'side-nav-card' && !isLiveSideNavCard(anchor)) {
        continue
      }

      const channel = extractChannel(anchor.getAttribute('href') ?? '')

      if (!channel) {
        continue
      }

      seenAnchors.add(anchor)

      if (trackedCards.has(anchor)) {
        continue
      }

      const card = {
        channel,
        anchor,
        surface,
        title: readTitle(anchor, surface),
      }

      trackedCards.set(anchor, card)
      options.onCardFound(card)
    }

    for (const [anchor, card] of trackedCards) {
      if (seenAnchors.has(anchor) && anchor.isConnected) {
        continue
      }

      trackedCards.delete(anchor)
      options.onCardRemoved(card)
    }
  }

  const scheduleScan = () => {
    if (animationFrameId !== 0) {
      return
    }

    animationFrameId = window.requestAnimationFrame(scan)
  }

  scan()

  const observer = new MutationObserver(scheduleScan)
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  })

  return () => {
    observer.disconnect()

    if (animationFrameId !== 0) {
      window.cancelAnimationFrame(animationFrameId)
    }

    for (const card of trackedCards.values()) {
      options.onCardRemoved(card)
    }

    trackedCards.clear()
  }
}
