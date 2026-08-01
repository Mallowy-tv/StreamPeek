import { createEmbedFallback } from '../player/embed-fallback'
import { createPreviewPlayer } from '../player/preview-player'
import { readCostreamDataFromCache } from './apollo-cache-reader'
import { parseViewerCount, readVisibleText } from './twitch-card-observer'
import type { PreviewRenderable, TwitchCardTarget, TwitchCoStreamer } from '../shared/types'

const HOVER_DELAY_MS = 350
const PREVIEW_LEAVE_DELAY_MS = 500
const VIEWPORT_PADDING_PX = 12

const SIDE_NAV_PREVIEW_GAP_PX = 12
const SIDE_NAV_PREVIEW_MAX_WIDTH_PX = 460
const SIDE_NAV_PREVIEW_MIN_WIDTH_PX = 380

const DIRECTORY_PREVIEW_SCALE = 1.25
const DIRECTORY_PREVIEW_MIN_WIDTH_PX = 340
const DIRECTORY_PREVIEW_MAX_WIDTH_PX = 560

// Constant scroll speed for the title marquee, independent of title length
// (see buildPreviewTitle). Must match the 62% keyframe in style.css.
const MARQUEE_SPEED_PX_PER_SEC = 45
const MARQUEE_SCROLL_FRACTION = 0.62
const MARQUEE_MIN_SCROLL_DURATION_S = 3

const PREVIEW_VIEWERS_ICON =
  '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 8.5a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5Zm6.5 0a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5ZM1.75 15.75c0-2.485 2.35-4.5 5.25-4.5s5.25 2.015 5.25 4.5v.5h-10.5v-.5Zm11.9-2.916c1.607.36 2.85 1.516 2.85 2.916v.5h-2.5v-.5c0-1.033-.3-1.978-.83-2.77.163.02.323.043.48.07Z" fill="currentColor"/></svg>'

const PREVIEW_CHEVRON_ICON =
  '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.25 7.5 10 12.25 14.75 7.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>'

// Twitch's own hover tooltips. The channel-title one is sidebar-only. The
// Guest Star / co-streaming roster one is matched by class suffix (not the
// exact `.side-nav-guest-star-tooltip__body` class) since the directory
// grid's variant uses a different prefix — both get suppressed visually
// while our preview is active. Co-streamer *data* no longer depends on this
// tooltip mounting at all (see apollo-cache-reader.ts / readCoStreamers in
// twitch-card-observer.ts — the full roster + real viewer counts come
// straight from Twitch's own Apollo cache now), but it's still suppressed
// visually here so it doesn't show up looking redundant next to our own
// preview, and readGuestStarCoStreamers below stays as a last-resort
// fallback for the rare case the Apollo read comes up empty on both
// attempts.
const CHANNEL_TITLE_TOOLTIP_SELECTOR = '.online-side-nav-channel-tooltip__body'
const GUEST_STAR_TOOLTIP_SELECTOR = '[class*="guest-star-tooltip__body"]'
const NATIVE_HOVER_TOOLTIP_SELECTOR = `${CHANNEL_TITLE_TOOLTIP_SELECTOR}, ${GUEST_STAR_TOOLTIP_SELECTOR}`

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
  resizeObserver: ResizeObserver | null
  applyCoStreamers: ((coStreamers: TwitchCoStreamer[]) => void) | null
  applyTooltipTitle: ((title: string) => void) | null
  restoreTitleAttributes: (() => void) | null
}

function clearTimer(timerId: number | null) {
  if (timerId !== null) {
    window.clearTimeout(timerId)
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
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

function buildPreviewViewerPill(binding: CardBinding): HTMLDivElement | null {
  if (!binding.card.viewerCount) {
    return null
  }

  const viewerPill = document.createElement('div')
  viewerPill.className = 'streampeek-side-nav-viewer-pill'

  const icon = document.createElement('span')
  icon.className = 'streampeek-side-nav-icon'
  icon.innerHTML = PREVIEW_VIEWERS_ICON

  const count = document.createElement('span')
  count.textContent = binding.card.viewerCount

  viewerPill.append(icon, count)

  return viewerPill
}

function buildCoStreamerAvatarImages(coStreamers: TwitchCoStreamer[]): HTMLImageElement[] {
  return coStreamers.map((coStreamer) => {
    const avatar = document.createElement('img')
    avatar.className = 'streampeek-side-nav-costream-avatar'
    avatar.alt = ''
    avatar.src = coStreamer.avatarUrl ?? ''
    return avatar
  })
}

function buildCoStreamerRow(coStreamer: TwitchCoStreamer): HTMLAnchorElement {
  const row = document.createElement('a')
  row.className = 'streampeek-side-nav-costream-row'
  row.href = `https://www.twitch.tv/${encodeURIComponent(coStreamer.channel)}`

  const avatar = document.createElement('img')
  avatar.className = 'streampeek-side-nav-costream-row-avatar'
  avatar.alt = ''
  avatar.src = coStreamer.avatarUrl ?? ''

  const name = document.createElement('span')
  name.className = 'streampeek-side-nav-costream-row-name'
  name.textContent = coStreamer.displayName

  row.append(avatar, name)

  if (coStreamer.viewerCount) {
    const viewers = document.createElement('span')
    viewers.className = 'streampeek-side-nav-costream-row-viewers'

    const dot = document.createElement('span')
    dot.className = 'streampeek-side-nav-live-dot'

    const count = document.createElement('span')
    count.textContent = coStreamer.viewerCount

    viewers.append(dot, count)
    row.append(viewers)
  }

  return row
}

// Sidebar-only: the real stream title only shows up here, in Twitch's own
// hover tooltip — same lazy-population situation as the Guest Star roster.
function readSideNavTooltipTitle(): string | null {
  const title = document
    .querySelector<HTMLElement>('.online-side-nav-channel-tooltip__body p')
    ?.textContent
    ?.trim()

  return title && title.length > 0 ? title : null
}

// Sidebar-only in practice — see the NATIVE_HOVER_TOOLTIP_SELECTOR comment
// above for why this never mounts for directory cards.
function readGuestStarCoStreamers(): TwitchCoStreamer[] {
  const tooltip = document.querySelector<HTMLElement>(GUEST_STAR_TOOLTIP_SELECTOR)

  if (!tooltip) {
    return []
  }

  const avatars = Array.from(tooltip.querySelectorAll<HTMLImageElement>('img[alt]'))
  const viewerCounts = Array.from(
    tooltip.querySelectorAll<HTMLElement>('span[aria-label="individual-view-count"]'),
  )

  const coStreamers: TwitchCoStreamer[] = []

  // Index 0 is always the hovered channel itself (listed before the "Live
  // with:" roster); everything after it is an actual co-streamer.
  for (let index = 1; index < avatars.length; index += 1) {
    const displayName = avatars[index].alt.trim()

    if (!displayName) {
      continue
    }

    const viewerCountElement = viewerCounts[index]

    coStreamers.push({
      channel: displayName.toLowerCase(),
      displayName,
      avatarUrl: avatars[index].src || null,
      viewerCount: viewerCountElement ? parseViewerCount(readVisibleText(viewerCountElement)) : null,
    })
  }

  return coStreamers
}

function buildCoStreamingSection(binding: CardBinding, requestReposition: () => void): HTMLDivElement {
  const section = document.createElement('div')
  section.className = 'streampeek-side-nav-costream'
  section.hidden = true

  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'streampeek-side-nav-costream-toggle'

  const avatarSlot = document.createElement('div')
  avatarSlot.className = 'streampeek-side-nav-costream-avatars'

  const label = document.createElement('span')
  label.className = 'streampeek-side-nav-costream-label'
  label.textContent = 'CO-STREAMING'

  const count = document.createElement('span')
  count.className = 'streampeek-side-nav-costream-count'

  const chevron = document.createElement('span')
  chevron.className = 'streampeek-side-nav-costream-chevron'
  chevron.innerHTML = PREVIEW_CHEVRON_ICON

  toggle.append(avatarSlot, label, count, chevron)

  const list = document.createElement('div')
  list.className = 'streampeek-side-nav-costream-list'

  section.append(toggle, list)

  let coStreamers: TwitchCoStreamer[] = []
  let isExpanded = false

  toggle.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()

    isExpanded = !isExpanded
    section.dataset.expanded = isExpanded ? 'true' : 'false'
    list.replaceChildren(...(isExpanded ? coStreamers.map(buildCoStreamerRow) : []))
    requestReposition()
  })

  // Left assigned (not nulled) after a synchronous apply below, so a later
  // tooltip success can still come in and upgrade a static single-companion
  // result to the fuller roster with real viewer counts.
  binding.applyCoStreamers = (resolved) => {
    if (resolved.length === 0) {
      return
    }

    coStreamers = resolved
    count.textContent = String(resolved.length)
    avatarSlot.replaceChildren(...buildCoStreamerAvatarImages(resolved))
    section.hidden = false
    requestReposition()

    if (isExpanded) {
      list.replaceChildren(...coStreamers.map(buildCoStreamerRow))
    }
  }

  // Apply whatever was already resolved when this card was built (see
  // readCoStreamers in twitch-card-observer.ts) immediately — usually the
  // full Apollo-cache roster already, occasionally a lesser fallback if the
  // Apollo client hadn't been located yet at that point. `activate()` below
  // retries the Apollo read once more (by which point the page is almost
  // certainly fully hydrated) and can upgrade this.
  if (binding.card.coStreamers.length > 0) {
    binding.applyCoStreamers(binding.card.coStreamers)
  }

  return section
}

function buildPreviewTitle(binding: CardBinding): HTMLDivElement {
  const titleWrap = document.createElement('div')
  titleWrap.className = 'streampeek-side-nav-title'

  const track = document.createElement('span')
  track.className = 'streampeek-side-nav-title-track'
  titleWrap.append(track)

  const applyText = (text: string) => {
    titleWrap.classList.remove('streampeek-side-nav-title--marquee')
    track.replaceChildren(document.createTextNode(text))

    // Only scroll titles that actually overflow their box; measuring requires
    // layout, so this runs one frame after the element is attached to the DOM.
    window.requestAnimationFrame(() => {
      if (!titleWrap.isConnected || track.textContent !== text) {
        return
      }

      const isOverflowing = track.scrollWidth > titleWrap.clientWidth + 1

      if (!isOverflowing) {
        return
      }

      const buildGap = () => {
        const gap = document.createElement('span')
        gap.className = 'streampeek-side-nav-title-gap'
        gap.setAttribute('aria-hidden', 'true')
        return gap
      }

      // Two identical [text][gap] copies back to back so that scrolling by
      // exactly one copy's width (-50%) lines up seamlessly with the start.
      track.replaceChildren(
        document.createTextNode(text),
        buildGap(),
        document.createTextNode(text),
        buildGap(),
      )
      titleWrap.classList.add('streampeek-side-nav-title--marquee')

      // A fixed animation-duration means longer titles travel farther in the
      // same time, so they visibly scroll faster — the opposite of what a
      // "constant speed" marquee should do. Derive the duration from the
      // actual distance instead (one copy's width, since translateX(-50%)
      // moves half of the now-doubled track), so px/sec stays constant. The
      // scroll covers MARQUEE_SCROLL_FRACTION of the keyframe timeline (see
      // the 62% keyframe below) — the rest is the hold-before-looping pause,
      // which this keeps proportional rather than removing it.
      const unitWidthPx = track.scrollWidth / 2
      const scrollDurationS = Math.max(unitWidthPx / MARQUEE_SPEED_PX_PER_SEC, MARQUEE_MIN_SCROLL_DURATION_S)
      const totalDurationS = scrollDurationS / MARQUEE_SCROLL_FRACTION
      track.style.setProperty('--streampeek-marquee-duration', `${totalDurationS.toFixed(2)}s`)
    })
  }

  applyText(binding.card.title.trim() || binding.card.displayName)

  // The sidebar row's own DOM (twitch-card-observer.ts) rarely has the real
  // title yet — Twitch fills `side-nav-title` in lazily on hover, same as the
  // Guest Star roster. The channel-name fallback above covers the gap until
  // the native tooltip (the authoritative source) becomes available.
  if (binding.card.surface === 'side-nav-card') {
    binding.applyTooltipTitle = applyText
  }

  return titleWrap
}

function buildPreviewFooter(binding: CardBinding, requestReposition: () => void): HTMLDivElement {
  const footer = document.createElement('div')
  footer.className = 'streampeek-side-nav-footer'

  const info = document.createElement('div')
  info.className = 'streampeek-side-nav-footer-info'

  if (binding.card.avatarUrl) {
    const avatar = document.createElement('img')
    avatar.className = 'streampeek-side-nav-footer-avatar'
    avatar.alt = ''
    avatar.src = binding.card.avatarUrl
    info.append(avatar)
  }

  const text = document.createElement('div')
  text.className = 'streampeek-side-nav-footer-text'
  text.append(buildPreviewTitle(binding))

  const meta = document.createElement('div')
  meta.className = 'streampeek-side-nav-footer-meta'

  const name = document.createElement('a')
  name.className = 'streampeek-side-nav-footer-name'
  name.href = binding.card.anchor.href
  name.textContent = binding.card.displayName
  meta.append(name)

  if (binding.card.category) {
    const dot = document.createElement('span')
    dot.className = 'streampeek-side-nav-footer-dot'
    dot.textContent = '·'

    const category = document.createElement('span')
    category.className = 'streampeek-side-nav-footer-category'
    category.textContent = binding.card.category

    meta.append(dot, category)
  }

  text.append(meta)
  info.append(text)
  footer.append(info)

  footer.append(buildCoStreamingSection(binding, requestReposition))

  return footer
}

function wrapFloatingPreviewRenderable(
  binding: CardBinding,
  content: HTMLElement,
  requestReposition: () => void,
): HTMLDivElement {
  const shell = document.createElement('div')
  shell.className = 'streampeek-side-nav-shell'

  const video = document.createElement('div')
  video.className = 'streampeek-side-nav-video'
  video.append(content)

  const viewerPill = buildPreviewViewerPill(binding)

  if (viewerPill) {
    video.append(viewerPill)
  }

  shell.append(video, buildPreviewFooter(binding, requestReposition))

  return shell
}

// Chrome shows its own OS-level tooltip for any element with a [title]
// attribute after a short hover delay — with our own big floating preview
// also on screen, that native tooltip just becomes visual clutter/overlap.
// title="..." isn't a rendered DOM node CSS can hide, so it has to be
// removed and put back once we're done (both surfaces have several: avatar
// alts, channel-name <p title>, the directory card's <h4 title>, etc).
function suppressNativeTitleTooltips(scope: Element): () => void {
  const elementsWithTitle: HTMLElement[] = []

  if (scope instanceof HTMLElement && scope.hasAttribute('title')) {
    elementsWithTitle.push(scope)
  }

  elementsWithTitle.push(...scope.querySelectorAll<HTMLElement>('[title]'))

  const originalTitles = elementsWithTitle.map((element) => element.getAttribute('title'))

  for (const element of elementsWithTitle) {
    element.removeAttribute('title')
  }

  return () => {
    elementsWithTitle.forEach((element, index) => {
      const originalTitle = originalTitles[index]

      if (originalTitle !== null) {
        element.setAttribute('title', originalTitle)
      }
    })
  }
}

function getTitleAttributeScope(card: TwitchCardTarget): Element {
  if (card.surface === 'directory-card') {
    return card.anchor.closest('article') ?? card.anchor
  }

  return card.anchor
}

function markSideNavTooltipNodes() {
  const tooltipBodies = document.querySelectorAll<HTMLElement>(NATIVE_HOVER_TOOLTIP_SELECTOR)

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

// Shared by both floating preview kinds: sets left/width, then measures the
// actual rendered height (footer + optional co-streaming list make this
// variable) to clamp a vertically-centered top within the viewport.
function positionFloatingPreview(overlayRoot: HTMLDivElement, anchorRect: DOMRect, left: number, width: number) {
  const viewportHeight = window.innerHeight

  overlayRoot.style.left = `${left}px`
  overlayRoot.style.width = `${width}px`

  const previewHeight = overlayRoot.getBoundingClientRect().height
  const centeredTop = anchorRect.top + anchorRect.height / 2 - previewHeight / 2
  const top = clamp(
    centeredTop,
    VIEWPORT_PADDING_PX,
    Math.max(VIEWPORT_PADDING_PX, viewportHeight - previewHeight - VIEWPORT_PADDING_PX),
  )

  overlayRoot.style.top = `${top}px`
}

// Sidebar rows are narrow, so the preview flows out to whichever side of the
// row has room instead of growing from the row itself.
function updateSideNavPreviewPosition(binding: CardBinding) {
  if (!binding.overlayRoot) {
    return
  }

  const anchorRect = binding.card.anchor.getBoundingClientRect()
  const viewportWidth = window.innerWidth
  const maxViewportWidth = Math.max(0, viewportWidth - VIEWPORT_PADDING_PX * 2)
  const previewWidth = clamp(
    Math.min(SIDE_NAV_PREVIEW_MAX_WIDTH_PX, maxViewportWidth),
    Math.min(SIDE_NAV_PREVIEW_MIN_WIDTH_PX, maxViewportWidth),
    Math.max(SIDE_NAV_PREVIEW_MIN_WIDTH_PX, maxViewportWidth),
  )

  let left = anchorRect.right + SIDE_NAV_PREVIEW_GAP_PX

  if (left + previewWidth > viewportWidth - VIEWPORT_PADDING_PX) {
    left = anchorRect.left - SIDE_NAV_PREVIEW_GAP_PX - previewWidth
  }

  left = clamp(left, VIEWPORT_PADDING_PX, viewportWidth - previewWidth - VIEWPORT_PADDING_PX)

  positionFloatingPreview(binding.overlayRoot, anchorRect, left, previewWidth)
}

// Directory grid cards are already a reasonable size, so the preview just
// grows from the card's own rect instead of anchoring to a side. (Briefly
// tried anchoring below/above instead, to keep the real card's rect
// genuinely hovered for Twitch's Guest Star tooltip — rejected: bad UX for
// no payoff, since the tooltip still didn't reliably show up. Co-streamer
// data is being pursued via a different route now; see
// TwitchCardTarget.coStreamers and todo.md.)
function updateDirectoryCardPreviewPosition(binding: CardBinding) {
  if (!binding.overlayRoot) {
    return
  }

  const anchorRect = binding.card.anchor.getBoundingClientRect()
  const viewportWidth = window.innerWidth
  const maxViewportWidth = Math.max(0, viewportWidth - VIEWPORT_PADDING_PX * 2)
  const previewWidth = clamp(
    anchorRect.width * DIRECTORY_PREVIEW_SCALE,
    Math.min(DIRECTORY_PREVIEW_MIN_WIDTH_PX, maxViewportWidth),
    Math.min(DIRECTORY_PREVIEW_MAX_WIDTH_PX, maxViewportWidth),
  )

  const centeredLeft = anchorRect.left + anchorRect.width / 2 - previewWidth / 2
  const left = clamp(centeredLeft, VIEWPORT_PADDING_PX, viewportWidth - previewWidth - VIEWPORT_PADDING_PX)

  positionFloatingPreview(binding.overlayRoot, anchorRect, left, previewWidth)
}

function updateFloatingPreviewPosition(binding: CardBinding) {
  if (binding.card.surface === 'side-nav-card') {
    updateSideNavPreviewPosition(binding)
  } else {
    updateDirectoryCardPreviewPosition(binding)
  }
}

function ensureOverlayRoot(binding: CardBinding, deactivate: (binding: CardBinding) => void): HTMLDivElement {
  if (binding.overlayRoot) {
    return binding.overlayRoot
  }

  binding.card.anchor.dataset.streampeekActive = 'true'

  const overlayRoot = document.createElement('div')
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
    }, PREVIEW_LEAVE_DELAY_MS)
  }

  overlayRoot.addEventListener('mouseenter', binding.floatingEnterHandler)
  overlayRoot.addEventListener('mouseleave', binding.floatingLeaveHandler)
  document.body.append(overlayRoot)

  binding.resizeObserver = new ResizeObserver(() => {
    updateFloatingPreviewPosition(binding)
  })
  binding.resizeObserver.observe(overlayRoot)

  binding.overlayRoot = overlayRoot
  updateFloatingPreviewPosition(binding)

  return overlayRoot
}

export function createHoverController() {
  const bindings = new Map<HTMLAnchorElement, CardBinding>()
  let activeBinding: CardBinding | null = null
  let sideNavTooltipSuppressionCount = 0

  // Retries the Apollo-cache co-streamer read (see readCoStreamers in
  // twitch-card-observer.ts) once more at activation time. The only reason
  // the build-time attempt would have come up empty is that
  // findApolloClient() hadn't located the client yet — by activation time
  // (after HOVER_DELAY_MS plus the user actually hovering) the page has
  // almost certainly finished hydrating, so this is a near-certain second
  // chance rather than a real retry loop. Called once, right after
  // applyCoStreamers exists (see mountRenderable) — no need for the
  // mutation-driven polling the tooltip fallback below needs, since the
  // cache is either already populated or it isn't; there's nothing to wait
  // on.
  const tryApplyCostreamCache = () => {
    if (!activeBinding?.applyCoStreamers) {
      return
    }

    const cached = readCostreamDataFromCache(activeBinding.card.channel)

    if (!cached || cached.coStreamers.length === 0) {
      return
    }

    const apply = activeBinding.applyCoStreamers
    activeBinding.applyCoStreamers = null
    apply(cached.coStreamers)
  }

  // Twitch's Guest Star tooltip only exists in the DOM once Twitch's own hover
  // logic decides to render it, which can land before or after our own preview
  // mounts. Checking on every relevant mutation (plus once right after mount,
  // see mountRenderable) covers both orderings without polling. Last-resort
  // fallback now that co-streamer data mainly comes from Apollo's cache (see
  // tryApplyCostreamCache above) — only matters if that comes up empty too,
  // and only ever fires for the sidebar surface in practice; see
  // readGuestStarCoStreamers.
  const tryApplyGuestStarCoStreamers = () => {
    if (!activeBinding?.applyCoStreamers) {
      return
    }

    const coStreamers = readGuestStarCoStreamers()

    if (coStreamers.length === 0) {
      return
    }

    const apply = activeBinding.applyCoStreamers
    activeBinding.applyCoStreamers = null
    apply(coStreamers)
  }

  // Same lazy-population situation as the Guest Star roster above: the real
  // title only exists once Twitch's own tooltip renders it in.
  const tryApplySideNavTooltipTitle = () => {
    if (!activeBinding?.applyTooltipTitle) {
      return
    }

    const title = readSideNavTooltipTitle()

    if (!title) {
      return
    }

    const apply = activeBinding.applyTooltipTitle
    activeBinding.applyTooltipTitle = null
    apply(title)
  }

  const sideNavTooltipObserver = new MutationObserver(() => {
    markSideNavTooltipNodes()
    tryApplyGuestStarCoStreamers()
    tryApplySideNavTooltipTitle()
  })

  const syncSideNavTooltipSuppression = () => {
    setSideNavTooltipSuppressed(sideNavTooltipSuppressionCount > 0, sideNavTooltipObserver)
  }

  // Applies to both surfaces now — the directory grid's Guest Star tooltip
  // needs the same visual suppression + scraping treatment as the sidebar's.
  const setBindingSideNavTooltipSuppressed = (binding: CardBinding, isSuppressed: boolean) => {
    if (binding.isSideNavTooltipSuppressed === isSuppressed) {
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

    if (binding.overlayRoot && binding.floatingEnterHandler) {
      binding.overlayRoot.removeEventListener('mouseenter', binding.floatingEnterHandler)
    }

    if (binding.overlayRoot && binding.floatingLeaveHandler) {
      binding.overlayRoot.removeEventListener('mouseleave', binding.floatingLeaveHandler)
    }

    binding.resizeObserver?.disconnect()
    binding.resizeObserver = null

    binding.overlayRoot?.remove()
    binding.overlayRoot = null
    binding.floatingEnterHandler = null
    binding.floatingLeaveHandler = null
    binding.applyCoStreamers = null
    binding.applyTooltipTitle = null
    binding.restoreTitleAttributes?.()
    binding.restoreTitleAttributes = null
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
    overlayRoot.replaceChildren(
      wrapFloatingPreviewRenderable(binding, renderable.element, () => updateFloatingPreviewPosition(binding)),
    )
    binding.renderable = renderable
    updateFloatingPreviewPosition(binding)

    // Order matters: Apollo's cache is the richer source, so it's tried
    // first — if it succeeds it nulls out applyCoStreamers, making the
    // tooltip fallback right after a correct no-op. Covers the case where
    // Twitch's tooltip already rendered during our own hover delay, before
    // applyCoStreamers/applyTooltipTitle existed to catch it.
    tryApplyCostreamCache()
    tryApplyGuestStarCoStreamers()
    tryApplySideNavTooltipTitle()
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

    binding.restoreTitleAttributes?.()
    binding.restoreTitleAttributes = suppressNativeTitleTooltips(getTitleAttributeScope(binding.card))

    const overlayRoot = ensureOverlayRoot(binding, deactivate)
    overlayRoot.replaceChildren(buildLoadingState(binding.card.channel))
    updateFloatingPreviewPosition(binding)
    clearRenderable(binding)

    const isDirectoryCard = binding.card.surface === 'directory-card'

    mountRenderable(
      binding,
      createPreviewPlayer({
        authToken: readTwitchAuthToken(),
        channel: binding.card.channel,
        title: binding.card.title,
        enableClickToPause: !isDirectoryCard,
        onNavigate: isDirectoryCard
          ? () => {
              binding.card.anchor.click()
              deactivate(binding)
            }
          : undefined,
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
      applyCoStreamers: null,
      applyTooltipTitle: null,
      card,
      restoreTitleAttributes: null,
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
        }, PREVIEW_LEAVE_DELAY_MS)
      },
      leaveTimeoutId: null,
      overlayRoot: null,
      renderable: null,
      resizeObserver: null,
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
    if (!activeBinding || !activeBinding.overlayRoot) {
      return
    }

    if (!activeBinding.card.anchor.isConnected) {
      deactivate(activeBinding)
      return
    }

    updateFloatingPreviewPosition(activeBinding)
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
