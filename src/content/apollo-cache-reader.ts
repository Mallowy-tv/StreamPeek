import type { TwitchCoStreamer } from '../shared/types'

// Twitch's Apollo Client instance isn't exposed anywhere on `window`
// (confirmed live: `Object.keys(window).filter(k => /apollo/i.test(k))`
// returns nothing) — but every component using `useQuery`/`useApolloClient`
// holds a reference to it in its own React hook state, reachable by walking
// the fiber tree from any DOM node that's part of the app. Confirmed live
// (2026-07-31/08-01, user ran the search in DevTools) that a component's
// hook state literally has a `.client` property whose `.cache.extract()`
// returns Apollo's full normalized cache, and that cache already contains
// each live stream's `costreamDetails` (roster + real per-person viewer
// counts) — the same data Twitch's own "Live with:" hover tooltip reads,
// but readable here with no hover, no tooltip DOM, and no network request at
// all, since it's already been fetched as part of whatever query populated
// the page.
interface FiberNode {
  memoizedState: unknown
  return: FiberNode | null
  child: FiberNode | null
  sibling: FiberNode | null
  type: unknown
}

// Every cached entity is a normalized GraphQL object whose field shape
// varies per query, so field values are read defensively (see the
// getString/getNumber/getEntity/getArray helpers below) rather than typed
// precisely — there's no schema available to type this against.
type CacheEntity = Record<string, unknown>
type NormalizedCache = Record<string, CacheEntity>

interface ApolloLikeClient {
  cache: {
    extract: () => NormalizedCache
  }
}

function getFiber(el: HTMLElement): FiberNode | null {
  const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'))

  return key ? ((el as unknown as Record<string, unknown>)[key] as FiberNode) : null
}

function findRootFiber(fiber: FiberNode): FiberNode {
  let current = fiber

  while (current.return) {
    current = current.return
  }

  return current
}

function looksLikeApolloClient(value: unknown): value is ApolloLikeClient {
  return (
    typeof value === 'object' &&
    value !== null &&
    'cache' in value &&
    typeof (value as { cache?: { extract?: unknown } }).cache?.extract === 'function'
  )
}

// Generous but bounded — Twitch's page has thousands of components, and this
// only ever needs to run once (the found client is cached for the rest of
// the page's lifetime as a stable singleton).
const MAX_FIBER_NODES_VISITED = 30000
const MAX_HOOKS_PER_FIBER = 25

function findApolloClientFromFiber(root: FiberNode): ApolloLikeClient | null {
  const stack: (FiberNode | null)[] = [root]
  let visited = 0

  while (stack.length > 0 && visited < MAX_FIBER_NODES_VISITED) {
    const node = stack.pop()

    if (!node) {
      continue
    }

    visited += 1

    let hook = node.memoizedState as { memoizedState?: unknown; next?: unknown } | null | undefined
    let hookIndex = 0

    while (hook && typeof hook === 'object' && hookIndex < MAX_HOOKS_PER_FIBER) {
      const state = hook.memoizedState

      if (looksLikeApolloClient(state)) {
        return state
      }

      if (state && typeof state === 'object' && looksLikeApolloClient((state as { client?: unknown }).client)) {
        return (state as { client: ApolloLikeClient }).client
      }

      hook = hook.next as typeof hook
      hookIndex += 1
    }

    if (node.sibling) {
      stack.push(node.sibling)
    }

    if (node.child) {
      stack.push(node.child)
    }
  }

  return null
}

let cachedClient: ApolloLikeClient | null = null

// The client is a stable singleton created once at app bootstrap — once
// found, it stays valid for the rest of the page's lifetime regardless of
// which specific component we happened to find it through unmounting later,
// so it's safe (and cheap) to cache indefinitely rather than re-searching
// the whole fiber tree on every call.
function findApolloClient(): ApolloLikeClient | null {
  if (cachedClient) {
    return cachedClient
  }

  const anyElement = document.querySelector<HTMLElement>('#root, body > div')

  if (!anyElement) {
    return null
  }

  const fiber = getFiber(anyElement)

  if (!fiber) {
    return null
  }

  const client = findApolloClientFromFiber(findRootFiber(fiber))

  if (client) {
    cachedClient = client
  }

  return client
}

function isCacheRef(value: unknown): value is { __ref: string } {
  return typeof value === 'object' && value !== null && typeof (value as { __ref?: unknown }).__ref === 'string'
}

// Resolves an Apollo normalized-cache `{ __ref: "Type:id" }` pointer, or
// passes through an already-inline entity (some fields, like `roles` in the
// data seen live, are embedded directly rather than normalized by ref).
function resolveRef(cache: NormalizedCache, value: unknown): CacheEntity | null {
  if (isCacheRef(value)) {
    return cache[value.__ref] ?? null
  }

  return typeof value === 'object' && value !== null ? (value as CacheEntity) : null
}

function getString(entity: CacheEntity | null, key: string): string | null {
  const value = entity?.[key]

  return typeof value === 'string' ? value : null
}

function getNumber(entity: CacheEntity | null, key: string): number | null {
  const value = entity?.[key]

  return typeof value === 'number' ? value : null
}

function getEntity(cache: NormalizedCache, entity: CacheEntity | null, key: string): CacheEntity | null {
  return resolveRef(cache, entity?.[key])
}

function getArray(entity: CacheEntity | null, key: string): unknown[] {
  const value = entity?.[key]

  return Array.isArray(value) ? value : []
}

function formatViewerCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  }

  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  }

  return String(count)
}

export interface StreamCostreamData {
  costreamersCount: number
  totalViewersCount: string | null
  coStreamers: TwitchCoStreamer[]
}

// Looks up a channel's live co-streaming roster directly from Apollo's
// already-fetched cache. `channelLogin` is matched case-insensitively since
// every source we scrape it from (URL slugs, display names) varies in case.
export function readCostreamDataFromCache(channelLogin: string): StreamCostreamData | null {
  const client = findApolloClient()

  if (!client) {
    return null
  }

  const cache = client.cache.extract()
  const needle = channelLogin.toLowerCase()

  const userKey = Object.keys(cache).find((key) => {
    if (!key.startsWith('User:')) {
      return false
    }

    const login = getString(cache[key], 'login')

    return login !== null && login.toLowerCase() === needle
  })

  if (!userKey) {
    return null
  }

  const stream = getEntity(cache, cache[userKey], 'stream')
  const details = getEntity(cache, stream, 'costreamDetails')

  if (!details) {
    return null
  }

  const coStreamers: TwitchCoStreamer[] = getArray(details, 'topCostreamers')
    .map((ref) => resolveRef(cache, ref))
    .filter((costreamer): costreamer is CacheEntity => {
      const login = getString(costreamer, 'login')

      return login !== null && login.toLowerCase() !== needle
    })
    .map((costreamer) => {
      const theirStream = getEntity(cache, costreamer, 'stream')
      const theirViewerCount = getNumber(theirStream, 'viewersCount')
      const login = getString(costreamer, 'login') ?? ''

      return {
        channel: login,
        displayName: getString(costreamer, 'displayName') ?? login,
        avatarUrl: getString(costreamer, 'profileImageURL({"width":70})'),
        viewerCount: theirViewerCount !== null ? formatViewerCount(theirViewerCount) : null,
      }
    })

  const totalViewersCount = getNumber(details, 'totalViewersCount')

  return {
    costreamersCount: getNumber(details, 'costreamersCount') ?? coStreamers.length,
    totalViewersCount: totalViewersCount !== null ? formatViewerCount(totalViewersCount) : null,
    coStreamers,
  }
}
