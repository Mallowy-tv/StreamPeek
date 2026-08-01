import { readCostreamDataFromCache } from './apollo-cache-reader'
import type { TwitchCardTarget, TwitchCoStreamer, TwitchHoverSurface } from '../shared/types'

const DIRECTORY_CARD_SELECTOR = 'a[data-a-target="preview-card-image-link"][href^="/"]'
const SEARCH_RESULT_CARD_SELECTOR = 'div[data-a-target="search-result-live-channel"] > a[href^="/"]'
const RELATED_SEARCH_CARD_SELECTOR = '.search-result-related-live-channels__row-container article a[href^="/"]'
const EXPANDED_SIDE_NAV_CARD_SELECTOR = 'a.side-nav-card__link[href^="/"]'
const COLLAPSED_SIDE_NAV_CARD_SELECTOR = 'a.side-nav-card.tw-link[href^="/"]'
const SIDE_NAV_CARD_SELECTOR = `${EXPANDED_SIDE_NAV_CARD_SELECTOR}, ${COLLAPSED_SIDE_NAV_CARD_SELECTOR}`
const CARD_SELECTOR = `${DIRECTORY_CARD_SELECTOR}, ${SEARCH_RESULT_CARD_SELECTOR}, ${RELATED_SEARCH_CARD_SELECTOR}, ${SIDE_NAV_CARD_SELECTOR}`

interface ObserveTwitchCardsOptions {
  onCardFound: (card: TwitchCardTarget) => void
  onCardRemoved: (card: TwitchCardTarget) => void
}

function extractChannel(href: string): string | null {
  const trimmed = href.trim()

  if (trimmed.length === 0) {
    return null
  }

  let url: URL

  try {
    url = new URL(trimmed, 'https://www.twitch.tv')
  } catch {
    return null
  }

  if (url.origin !== 'https://www.twitch.tv') {
    return null
  }

  const segments = url.pathname.split('/').filter((segment) => segment.length > 0)

  if (segments.length !== 1) {
    return null
  }

  const [channel] = segments

  return channel.length > 0 ? channel : null
}

function detectSurface(anchor: HTMLAnchorElement): TwitchHoverSurface | null {
  if (
    anchor.matches(DIRECTORY_CARD_SELECTOR) ||
    anchor.matches(SEARCH_RESULT_CARD_SELECTOR) ||
    anchor.matches(RELATED_SEARCH_CARD_SELECTOR)
  ) {
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

function readAvatarImage(anchor: HTMLAnchorElement): HTMLImageElement | null {
  const image = anchor.querySelector('img[alt]')

  return image instanceof HTMLImageElement ? image : null
}

function readDisplayName(anchor: HTMLAnchorElement, channel: string): string {
  const avatarAlt = readAvatarImage(anchor)?.alt?.trim()

  return avatarAlt && avatarAlt.length > 0 ? avatarAlt : channel
}

// `.textContent` pulls in every descendant text node regardless of CSS
// visibility, so a visually-hidden a11y duplicate (e.g. a screen-reader-only
// "Live" label, or a second copy of the count for a responsive layout) gets
// concatenated right onto the visible text — "Live1515 viewers", or two
// adjacent copies of the same number read back as one doubled number.
// `innerText` respects visibility (layout-dependent, but these are always
// attached/visible sidebar or grid elements), so prefer it when available.
export function readVisibleText(element: HTMLElement): string {
  return element.innerText || element.textContent || ''
}

// Not anchored to the start: even after preferring innerText, some visible
// decorative text ("Live", "viewers") can still surround the number itself.
export function parseViewerCount(text: string): string | null {
  const match = text.match(/[\d.,]+[KMB]?/i)

  return match ? match[0] : null
}

function readViewerCount(anchor: HTMLAnchorElement): string | null {
  const statElement = anchor.querySelector<HTMLElement>('[data-a-target="side-nav-live-status"]')

  return statElement ? parseViewerCount(readVisibleText(statElement)) : null
}

function readCategory(anchor: HTMLAnchorElement): string | null {
  const category = anchor
    .querySelector<HTMLElement>('[data-a-target="side-nav-game-title"]')
    ?.textContent
    ?.trim()

  return category && category.length > 0 ? category : null
}

// Directory/search-result cards: the anchor matched by CARD_SELECTOR is just the
// thumbnail link (`preview-card-image-link`) — title, avatar, and channel name
// live in a *sibling* block under the same <article>, not inside that anchor.
function getDirectoryCardScope(anchor: HTMLAnchorElement): ParentNode {
  return anchor.closest('article') ?? anchor
}

function readDirectoryTitle(anchor: HTMLAnchorElement): string | null {
  const title = getDirectoryCardScope(anchor).querySelector<HTMLElement>('h4[title]')?.title?.trim()

  return title && title.length > 0 ? title : null
}

function readDirectoryAvatarImage(anchor: HTMLAnchorElement): HTMLImageElement | null {
  const image = getDirectoryCardScope(anchor).querySelector(
    'a[data-test-selector="preview-card-avatar"] img[alt]',
  )

  return image instanceof HTMLImageElement ? image : null
}

function readDirectoryDisplayName(anchor: HTMLAnchorElement, channel: string): string {
  const name = getDirectoryCardScope(anchor)
    .querySelector<HTMLElement>('[data-a-target="preview-card-channel-link"] p[title]')
    ?.textContent
    ?.trim()

  return name && name.length > 0 ? name : channel
}

function readDirectoryViewerCount(anchor: HTMLAnchorElement): string | null {
  const statElement = getDirectoryCardScope(anchor).querySelector<HTMLElement>('.tw-media-card-stat')

  return statElement ? parseViewerCount(readVisibleText(statElement)) : null
}

// Follows the same `data-a-target="preview-card-*"` naming convention as the
// already-confirmed `preview-card-channel-link`/`preview-card-avatar`/
// `preview-card-image-link` attributes, so this is a high-confidence guess
// rather than a blind one — unconfirmed against live DOM, see todo.md.
// Present directly on the card itself, so unlike the URL-derived fallback
// below this also works on surfaces that aren't a /directory/category/ page
// at all (search results, "while X is offline" recommendation shelves, etc.).
function readDirectoryCardCategory(anchor: HTMLAnchorElement): string | null {
  const category = getDirectoryCardScope(anchor)
    .querySelector<HTMLElement>('[data-a-target="preview-card-game-link"]')
    ?.textContent
    ?.trim()

  return category && category.length > 0 ? category : null
}

// The co-streamer info directory cards carry in their own static DOM (no
// hover needed) — small overlapping "guest" avatar(s) shown directly on the
// thumbnail for duo/group streams. Confirmed (user screenshot, 2026-07-31)
// this only ever surfaces at most one of the actual co-streamers even for a
// 3-person collab (Twitch's own "Use the Down Arrow Key for more guest info"
// hint implies the rest require simulated keyboard interaction to reveal, not
// present in the DOM up front) — so this is a hard ceiling of the static
// approach, not a selector bug. `querySelectorAll` in case a wider card ever
// does render more than one avatar without that interaction. No viewer count
// is available for any of them here (only the primary card's own aggregate
// count exists in this markup); see the TwitchCardTarget.coStreamers doc
// comment for why this is used instead of the fuller Guest Star tooltip
// roster on this surface.
function readDirectoryCompanion(anchor: HTMLAnchorElement): TwitchCoStreamer[] {
  const avatars = getDirectoryCardScope(anchor).querySelectorAll<HTMLImageElement>(
    '.primary-with-small-avatar__preview-card-mini-avatar img[alt]',
  )

  const coStreamers: TwitchCoStreamer[] = []

  for (const avatar of avatars) {
    const displayName = avatar.alt.trim()

    if (!displayName) {
      continue
    }

    coStreamers.push({
      channel: displayName.toLowerCase(),
      displayName,
      avatarUrl: avatar.src || null,
      viewerCount: null,
    })
  }

  return coStreamers
}

// A category-scoped directory page (/directory/category/<slug>) doesn't repeat
// the category per card since every card on the page already is that category
// — it's only shown once, in the page heading. Derive it from the URL slug
// instead of guessing at a per-card element that was never there to begin
// with. Doesn't apply to search/related-channel surfaces, which can mix
// categories on one page — the path just won't match there.
function readDirectoryPageCategory(): string | null {
  const match = location.pathname.match(/^\/directory\/category\/([^/]+)/)

  if (!match) {
    return null
  }

  const words = decodeURIComponent(match[1])
    .split('-')
    .filter((word) => word.length > 0)

  if (words.length === 0) {
    return null
  }

  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

function isLiveSideNavCard(anchor: HTMLAnchorElement): boolean {
  if (anchor.querySelector('[data-a-target="side-nav-live-status"]') !== null) {
    return true
  }

  return anchor.matches(COLLAPSED_SIDE_NAV_CARD_SELECTOR)
}

function isRelatedSearchCard(anchor: HTMLAnchorElement): boolean {
  return (
    anchor.matches(RELATED_SEARCH_CARD_SELECTOR) &&
    anchor.querySelector('img[alt]') !== null &&
    anchor.querySelector('.tw-channel-status-text-indicator') !== null
  )
}

// Apollo's cache (see apollo-cache-reader.ts) is the real, full-roster,
// real-viewer-count source — confirmed live against production data. It's
// tried first for both surfaces; the per-surface fallbacks below only kick
// in when it comes back empty, which mainly happens if the client hasn't
// been found yet this early (findApolloClient() needs at least one hydrated
// component on the page to walk up from — see hover-controller.ts's
// activate() for a second, later attempt that covers that gap).
function readCoStreamers(anchor: HTMLAnchorElement, surface: TwitchHoverSurface, channel: string): TwitchCoStreamer[] {
  const fromCache = readCostreamDataFromCache(channel)?.coStreamers

  if (fromCache && fromCache.length > 0) {
    return fromCache
  }

  return surface === 'directory-card' ? readDirectoryCompanion(anchor) : []
}

function buildCardTarget(anchor: HTMLAnchorElement, surface: TwitchHoverSurface, channel: string): TwitchCardTarget {
  if (surface === 'directory-card') {
    return {
      channel,
      anchor,
      surface,
      title: readDirectoryTitle(anchor) ?? readTitle(anchor, surface),
      displayName: readDirectoryDisplayName(anchor, channel),
      avatarUrl: readDirectoryAvatarImage(anchor)?.src || null,
      viewerCount: readDirectoryViewerCount(anchor),
      category: readDirectoryCardCategory(anchor) ?? readDirectoryPageCategory(),
      coStreamers: readCoStreamers(anchor, surface, channel),
    }
  }

  return {
    channel,
    anchor,
    surface,
    title: readTitle(anchor, surface),
    displayName: readDisplayName(anchor, channel),
    avatarUrl: readAvatarImage(anchor)?.src || null,
    viewerCount: readViewerCount(anchor),
    category: readCategory(anchor),
    coStreamers: readCoStreamers(anchor, surface, channel),
  }
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

      if (surface === 'directory-card' && anchor.matches(RELATED_SEARCH_CARD_SELECTOR) && !isRelatedSearchCard(anchor)) {
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

      const card = buildCardTarget(anchor, surface, channel)

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
