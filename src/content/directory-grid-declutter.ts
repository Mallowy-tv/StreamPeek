import { parseViewerCount, readVisibleText } from './twitch-card-observer'

// Requires a real preview-card thumbnail link inside, not just any
// `<article>` — Twitch's own promotional/widget panels (e.g. the
// "StreamDatabase" sponsored panel seen on the front page) are ALSO wrapped
// in an `<article>`, so a bare `article` selector swept those up as if they
// were just another card, wrongly grid-ifying and badging them. This reuses
// the already-confirmed `preview-card-image-link` attribute (see
// DIRECTORY_CARD_SELECTOR in twitch-card-observer.ts) to require it actually
// looks like a stream card.
const CHANNEL_CARD_SELECTOR = 'article:has(a[data-a-target="preview-card-image-link"])'
const CATEGORY_CARD_SELECTOR = '.game-card'
const LIVE_BADGE_SELECTOR = '.tw-channel-status-text-indicator'
const TAG_SELECTOR = '.tw-tag'
const FFZ_CLOCK_SELECTOR = '.ffz-uptime-element'
const VIEWER_STAT_SELECTOR = '.tw-media-card-stat'

// A hard ceiling on columns, not a fixed count — user wants at most 5 on a
// normal-to-wide screen, but cards shrinking to fit exactly 5 on a narrow
// window looks worse than just showing fewer, appropriately-sized cards (a
// literal `repeat(5, ...)` was tried and rejected for exactly this: on a
// narrower window it kept forcing 5 cramped columns instead of naturally
// dropping to 4 bigger ones). `auto-fit`/`minmax` with a real pixel minimum
// gives that natural reflow back; CHANNEL_GRID_MIN_COLUMN_PX is tuned so it
// still tops out at 5 on the container widths confirmed so far (~2000–2600px)
// without needing a hardcoded count.
const CHANNEL_GRID_COLUMNS = 5
const CHANNEL_GRID_MIN_COLUMN_PX = 440
const CATEGORY_GRID_MIN_COLUMN_PX = 220
const GRID_GAP_REM = 1
const MIN_CARD_SIBLINGS = 2
// Bounds how far `resolveGridWrapper` climbs the ancestor chain looking for a
// shared container. Without a cap, a genuinely lone/isolated card with no
// nearby siblings at any shallow level would keep climbing until it hit some
// far-up ancestor (in the worst case documentElement itself) — and if a
// second, totally unrelated lone card elsewhere on the page happened to climb
// to that same top-level ancestor, both would wrongly be treated as one grid.
// Real card grids/shelves always have a shared row/grid wrapper within a
// handful of levels, so capping the climb makes that false-merge scenario
// effectively impossible while still covering every shelf variant seen so far.
const MAX_CONTAINER_CLIMB = 6

// Same two-circle "group of people" icon as PREVIEW_VIEWERS_ICON in
// hover-controller.ts, for visual consistency with every other viewer count
// in the extension. (Briefly swapped for a single-eye icon suspecting it was
// the source of a "doubled" look — that turned out to be a real 6th card
// bleeding through, fixed in applyGridStyling; this icon was never the
// problem.)
const VIEWERS_ICON =
  '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 8.5a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5Zm6.5 0a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5ZM1.75 15.75c0-2.485 2.35-4.5 5.25-4.5s5.25 2.015 5.25 4.5v.5h-10.5v-.5Zm11.9-2.916c1.607.36 2.85 1.516 2.85 2.916v.5h-2.5v-.5c0-1.033-.3-1.978-.83-2.77.163.02.323.043.48.07Z" fill="currentColor"/></svg>'

// Inline `!important` instead of a CSS class + stylesheet rule — a stylesheet
// rule can still lose to a conflicting inline style Twitch applies directly
// to a specific element (inline `!important` always beats stylesheet
// `!important`, regardless of specificity/order); this can't be beaten the
// same way. Confirmed needed by user report (2026-07-31, screenshot): one
// card's native viewer icon+count stayed visible right alongside our own
// injected badge, producing a doubled icon that wasn't the StreamDatabase
// widget or a nesting issue — the class-based hide had silently lost on that
// one card.
function hideAll(root: ParentNode, selector: string) {
  for (const element of root.querySelectorAll<HTMLElement>(selector)) {
    element.style.setProperty('display', 'none', 'important')
  }
}

// Every card match whose own DOM chain runs through an ancestor that also
// matches CHANNEL_CARD_SELECTOR is dropped, keeping only the outermost card
// in any nesting chain. `:has()` matches a *descendant* link at any depth, so
// a widget/promo panel that embeds its own mini stream-preview somewhere
// inside itself (seen with the "StreamDatabase" panel — its own nested
// display for a "current" streamer independently satisfies the selector)
// would otherwise get decluttered/badged as if it were a second, separate
// card sitting right on top of the first — producing exactly the doubled
// icon+count the user reported, regardless of what that nested element
// actually is.
function findChannelCards(): HTMLElement[] {
  const cards: HTMLElement[] = []

  for (const article of document.querySelectorAll<HTMLElement>(CHANNEL_CARD_SELECTOR)) {
    if (article.parentElement?.closest(CHANNEL_CARD_SELECTOR)) {
      continue
    }

    cards.push(article)
  }

  return cards
}

// Creates the badge once per card, then just keeps its text in sync on later
// scans so it doesn't go stale as Twitch's own (hidden) viewer count updates.
function upsertViewerBadge(container: HTMLElement, statText: string) {
  // The badge is `position: absolute`, which positions it against the
  // nearest positioned ancestor — not necessarily this container, if
  // Twitch's own CSS leaves it `position: static`. When that happens every
  // card's badge falls through to the same shared ancestor (e.g. the whole
  // shelf) and stacks at one spot instead of each sitting in its own card.
  // Only force it when needed so an already-positioned container (Twitch's
  // own layout) isn't touched.
  if (getComputedStyle(container).position === 'static') {
    container.style.setProperty('position', 'relative', 'important')
  }

  let countSpan = container.querySelector<HTMLElement>('.streampeek-directory-viewer-badge-count')

  if (!countSpan) {
    const badge = document.createElement('div')
    badge.className = 'streampeek-directory-viewer-badge'

    const icon = document.createElement('span')
    icon.className = 'streampeek-side-nav-icon'
    icon.innerHTML = VIEWERS_ICON

    countSpan = document.createElement('span')
    countSpan.className = 'streampeek-directory-viewer-badge-count'

    badge.append(icon, countSpan)
    container.append(badge)
  }

  countSpan.textContent = statText
}

// Purely local to one <article> — no dependency on grid/container detection,
// so LIVE badge/tag/clock hiding and the viewer badge apply everywhere a
// channel card shows up (front page shelves, directory grids, "while X is
// offline" recommendation rows, search results, ...), even on the rare shelf
// variant `findGridContainers` below fails to classify as a grid.
function declutterCard(article: Element) {
  hideAll(article, LIVE_BADGE_SELECTOR)
  hideAll(article, TAG_SELECTOR)
  hideAll(article, FFZ_CLOCK_SELECTOR)

  if (!(article instanceof HTMLElement)) {
    return
  }

  const statElement = article.querySelector<HTMLElement>(VIEWER_STAT_SELECTOR)

  if (!statElement) {
    return
  }

  const statText = parseViewerCount(readVisibleText(statElement))

  if (!statText) {
    return
  }

  statElement.style.setProperty('display', 'none', 'important')
  // Anchored to the whole card, not a sub-element like the thumbnail's own
  // wrapper — that inner wrapper's box doesn't necessarily span the full
  // visual card (it can be a thin aspect-ratio shim with near-zero own
  // height), which put `top/right` in the wrong place. The card itself
  // reliably starts flush at the top, so this lands top-right consistently.
  upsertViewerBadge(article, statText)
}

// Climbs from a card element to the nearest ancestor that has 2+ element
// children — that ancestor is the shared row/grid container, and the child
// reached just before it is this card's "item wrapper" (the element actually
// worth resizing). This subsumes the old order-style-only heuristic (an
// order-styled wrapper naturally has 2+ order-styled siblings at the first
// hop) while also covering shelf variants that don't use inline `order`
// styling at all, e.g. simple flex/grid rows with no per-item positioning.
function resolveGridWrapper(card: HTMLElement): { container: HTMLElement; wrapper: HTMLElement } | null {
  let wrapper = card

  for (let depth = 0; depth < MAX_CONTAINER_CLIMB; depth += 1) {
    const parent = wrapper.parentElement

    if (!parent) {
      return null
    }

    if (parent.children.length >= MIN_CARD_SIBLINGS) {
      return { container: parent, wrapper }
    }

    wrapper = parent
  }

  return null
}

interface GridContainerInfo {
  isCategoryGrid: boolean
  wrappers: Set<HTMLElement>
}

// Finds grid-like shelves structurally instead of by a specific Twitch class
// name like `.tw-tower` — the front page alone has several differently
// class-named shelf variants ("Live channels", "Categories", per-game
// collections, "while X is offline" recommendations, ...), and guessing each
// one's class by screenshot doesn't scale. Grouping every card by the nearest
// shared ancestor (see resolveGridWrapper) works regardless of what that
// ancestor's own class name happens to be.
function findGridContainers(): Map<HTMLElement, GridContainerInfo> {
  const containers = new Map<HTMLElement, GridContainerInfo>()
  const cards: HTMLElement[] = [...findChannelCards(), ...document.querySelectorAll<HTMLElement>(CATEGORY_CARD_SELECTOR)]

  for (const card of cards) {
    const resolved = resolveGridWrapper(card)

    if (!resolved) {
      continue
    }

    let info = containers.get(resolved.container)

    if (!info) {
      info = { isCategoryGrid: card.matches(CATEGORY_CARD_SELECTOR), wrappers: new Set() }
      containers.set(resolved.container, info)
    }

    info.wrappers.add(resolved.wrapper)
  }

  for (const [container, info] of containers) {
    if (info.wrappers.size < MIN_CARD_SIBLINGS) {
      containers.delete(container)
    }
  }

  return containers
}

// A "shelf" is a curated, collapsible row (e.g. front-page "Live channels we
// think you'll like") that Twitch itself caps to one row behind an expand
// toggle — as opposed to a full listing page like /directory/category/<game>,
// which has no such toggle and is meant to keep wrapping into as many rows as
// there are results. Forcing `display: grid` on a shelf broke Twitch's own
// single-row collapse (grid just wraps everything it's given), so shelves
// need to be told to stay one row ourselves instead.
//
// Previously detected via nearby "Show more"/"Show all" toggle text, but that
// wording isn't consistent across shelves (confirmed at least 2 variants by
// screenshot, 2026-07-31) and at least one shelf ("Recommended smaller
// communities") showed 6-per-row with neither matching — chasing every
// wording variant doesn't scale any better than chasing every class name did
// earlier. The page section itself is a much more reliable signal: every
// shelf seen so far lives on the front page or a channel page, never on a
// /directory* page, which is always a genuine full listing with no
// row-capping at all. Keying off the URL instead of scanning nearby text for
// a toggle removes the wording guesswork entirely.
function isShelfPage(): boolean {
  return !location.pathname.startsWith('/directory')
}

function applyGridStyling(container: HTMLElement, info: GridContainerInfo) {
  // Kept purely for diagnosability (so a pasted DOM snapshot shows which way
  // a given shelf got classified) — no CSS keys off this anymore.
  container.dataset.streampeekGridKind = info.isCategoryGrid ? 'categories' : 'channels'

  // Inline `!important` beats any class-based stylesheet rule Twitch could
  // apply regardless of load order, which a plain stylesheet rule couldn't
  // reliably guarantee across every page/bundle.
  container.style.setProperty('display', 'grid', 'important')
  container.style.setProperty('gap', `${GRID_GAP_REM}rem`, 'important')
  container.style.setProperty(
    'grid-template-columns',
    `repeat(auto-fit, minmax(${info.isCategoryGrid ? CATEGORY_GRID_MIN_COLUMN_PX : CHANNEL_GRID_MIN_COLUMN_PX}px, 1fr))`,
    'important',
  )

  // Two earlier attempts tried to make a shelf's extra cards vanish purely
  // through CSS (fixed calc() column widths, then grid-auto-columns: 0px +
  // overflow: hidden) — both still let a 6th card's own content (specifically
  // its absolutely-positioned badge) render visibly at the edge of the 5th,
  // confirmed by a user-supplied DOM dump showing a real 6th card ("Suzooiey",
  // 76 viewers) whose badge was bleeding onto the 5th card. Relying on the
  // grid track sizing algorithm to fully contain an overflowing child turned
  // out to be too fragile to get right blind. `display: none` on the wrapper
  // itself is unambiguous — the element and everything inside it, badge
  // included, is removed from rendering entirely, no sizing/rounding/overflow
  // interaction to get wrong. `info.wrappers` is a Set built by iterating
  // cards in document order (see findGridContainers), so array index directly
  // matches on-page left-to-right order.
  //
  // How many to keep isn't a flat 5, though: `auto-fit` means the actual
  // column count depends on the container's current width, and on a narrower
  // window that's naturally fewer than 5 — reading it back via
  // `getComputedStyle` (which resolves `auto-fit` into a concrete track list)
  // after the property above is set tells us exactly how many columns the
  // browser actually produced for THIS width. `visibleCount` still caps at
  // CHANNEL_GRID_COLUMNS as a ceiling for wide screens, and this whole
  // section only applies to shelves, never a full listing page — those
  // should keep every card, wrapping into as many rows as needed.
  const isShelf = !info.isCategoryGrid && isShelfPage()
  const computedColumnCount = isShelf
    ? getComputedStyle(container).gridTemplateColumns.split(' ').filter(Boolean).length
    : 0
  const visibleCount = Math.min(computedColumnCount, CHANNEL_GRID_COLUMNS)

  ;[...info.wrappers].forEach((wrapper, index) => {
    if (isShelf && index >= visibleCount) {
      wrapper.style.setProperty('display', 'none', 'important')
      return
    }

    wrapper.style.setProperty('width', '100%', 'important')
    wrapper.style.setProperty('min-width', '0', 'important')
  })

  // Any direct child that isn't one of the tracked card wrappers (e.g. a
  // sponsored/widget panel like "StreamDatabase" sharing this row) is still
  // a grid item as far as the browser's concerned once `display: grid` is
  // forced on the container — CSS grid auto-places *every* direct child,
  // whether or not our own card-matching selector recognized it. Left alone
  // it can size itself arbitrarily (its own natural content width) and bleed
  // into the clipped edge of an adjacent real card. Hiding it here removes it
  // from grid layout entirely instead of just hoping overflow clips it clean.
  for (const child of container.children) {
    if (child instanceof HTMLElement && !info.wrappers.has(child)) {
      child.style.setProperty('display', 'none', 'important')
    }
  }
}

export function observeDirectoryGrid(): () => void {
  let animationFrameId = 0

  const scan = () => {
    animationFrameId = 0

    for (const article of findChannelCards()) {
      declutterCard(article)
    }

    for (const [container, info] of findGridContainers()) {
      applyGridStyling(container, info)
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
  }
}
