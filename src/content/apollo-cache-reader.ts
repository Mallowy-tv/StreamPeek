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

interface ApolloLikeClient {
  cache: {
    extract: () => Record<string, any>
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

// Resolves an Apollo normalized-cache `{ __ref: "Type:id" }` pointer.
function resolveRef(cache: Record<string, any>, value: unknown): Record<string, any> | null {
  if (value && typeof value === 'object' && '__ref' in (value as Record<string, unknown>)) {
    return cache[(value as { __ref: string }).__ref] ?? null
  }

  return (value as Record<string, any>) ?? null
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

    const login = cache[key]?.login

    return typeof login === 'string' && login.toLowerCase() === needle
  })

  if (!userKey) {
    return null
  }

  const stream = resolveRef(cache, cache[userKey].stream)
  const details = stream?.costreamDetails

  if (!details) {
    return null
  }

  const coStreamers: TwitchCoStreamer[] = (details.topCostreamers ?? [])
    .map((ref: unknown) => resolveRef(cache, ref))
    .filter((costreamer: Record<string, any> | null): costreamer is Record<string, any> => {
      return costreamer !== null && costreamer.login?.toLowerCase() !== needle
    })
    .map((costreamer: Record<string, any>) => {
      const theirStream = resolveRef(cache, costreamer.stream)
      const theirViewerCount = theirStream?.viewersCount

      return {
        channel: costreamer.login,
        displayName: costreamer.displayName ?? costreamer.login,
        avatarUrl: costreamer['profileImageURL({"width":70})'] ?? null,
        viewerCount: typeof theirViewerCount === 'number' ? formatViewerCount(theirViewerCount) : null,
      }
    })

  return {
    costreamersCount: details.costreamersCount ?? coStreamers.length,
    totalViewersCount: typeof details.totalViewersCount === 'number' ? formatViewerCount(details.totalViewersCount) : null,
    coStreamers,
  }
}
