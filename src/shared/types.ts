export type TwitchHoverSurface = 'directory-card' | 'side-nav-card'

export interface TwitchCardTarget {
  channel: string
  anchor: HTMLAnchorElement
  surface: TwitchHoverSurface
  title: string
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
}

export interface PreviewFrameStopMessage {
  type: 'streampeek:stop'
  sessionId: string
}

export interface PreviewFrameReadyMessage {
  type: 'streampeek:ready'
  sessionId: string
}

export type PreviewFrameMessage = PreviewFrameInitMessage | PreviewFrameStopMessage
export type PreviewFrameParentMessage = PreviewFrameReadyMessage

export const PREVIEW_AUDIO_STATE_STORAGE_KEY = 'streampeek.previewAudioState'
