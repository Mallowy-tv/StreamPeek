export type TwitchHoverSurface = 'directory-card' | 'side-nav-card'

export interface TwitchCardTarget {
  channel: string
  anchor: HTMLAnchorElement
  surface: TwitchHoverSurface
  title: string
  displayName: string
  avatarUrl: string | null
  viewerCount: string | null
  category: string | null
  /**
   * The full co-streaming roster with real per-person viewer counts, read
   * directly from Twitch's Apollo GraphQL cache (see
   * apollo-cache-reader.ts:readCostreamDataFromCache) — already-fetched
   * client state, no hover or native tooltip DOM involved. Falls back to a
   * single-companion, no-viewer-count scrape of the directory card's own
   * static DOM (or an empty array for side-nav cards) only if the Apollo
   * client hasn't been located yet at the time this card was built; see
   * hover-controller.ts's activate() for a second, later retry that covers
   * that gap.
   */
  coStreamers: TwitchCoStreamer[]
}

export interface TwitchCoStreamer {
  channel: string
  displayName: string
  avatarUrl: string | null
  viewerCount: string | null
}

export interface PlaybackSource {
  channel: string
  playlistUrl: string
  expiresAt: number
}

export interface PreviewRenderable {
  element: HTMLElement
  dispose: () => void
}

export interface PreviewAudioState {
  muted: boolean
  volume: number
  lastNonZeroVolume: number
}

export interface PreviewFrameInitMessage {
  type: 'streampeek:init'
  sessionId: string
  channel: string
  title: string
  authToken?: string
  /** Defaults to true (click pauses/resumes). Set false to have clicks request navigation instead. */
  enableClickToPause?: boolean
}

export interface PreviewFrameStopMessage {
  type: 'streampeek:stop'
  sessionId: string
}

export interface PreviewFrameReadyMessage {
  type: 'streampeek:ready'
  sessionId: string
}

export interface PreviewFrameNavigateMessage {
  type: 'streampeek:navigate'
  sessionId: string
}

export type PreviewFrameMessage = PreviewFrameInitMessage | PreviewFrameStopMessage
export type PreviewFrameParentMessage = PreviewFrameReadyMessage | PreviewFrameNavigateMessage

export const PREVIEW_AUDIO_STATE_STORAGE_KEY = 'streampeek.previewAudioState'
