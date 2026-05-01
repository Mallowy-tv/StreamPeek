import Hls, { type ErrorData } from 'hls.js'
import './preview-frame.css'
import { resolvePlaybackSource } from './player/playback-resolver'
import {
  PREVIEW_AUDIO_STATE_STORAGE_KEY,
  type PreviewAudioState,
  type PreviewFrameInitMessage,
  type PreviewFrameMessage,
  type PreviewFrameReadyMessage,
  type PreviewFrameStopMessage,
} from './shared/types'

function isInitMessage(value: unknown): value is PreviewFrameInitMessage {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Partial<PreviewFrameInitMessage>

  return (
    candidate.type === 'streampeek:init' &&
    typeof candidate.sessionId === 'string' &&
    typeof candidate.channel === 'string' &&
    typeof candidate.title === 'string'
  )
}

function isStopMessage(value: unknown): value is PreviewFrameStopMessage {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Partial<PreviewFrameStopMessage>

  return candidate.type === 'streampeek:stop' && typeof candidate.sessionId === 'string'
}

const root = document.getElementById('root')

if (!(root instanceof HTMLDivElement)) {
  throw new Error('Preview frame root not found')
}

const shell = document.createElement('main')
shell.className = 'streampeek-frame'
shell.dataset.playbackState = 'playing'

const video = document.createElement('video')
video.className = 'streampeek-frame__video'
video.autoplay = true
video.controls = false
video.muted = true
video.playsInline = true
video.preload = 'auto'

const controls = document.createElement('div')
controls.className = 'streampeek-frame__controls'

const muteButton = document.createElement('button')
muteButton.className = 'streampeek-frame__button'
muteButton.type = 'button'
muteButton.setAttribute('aria-label', 'Unmute preview')
muteButton.innerHTML = `
  <svg class="streampeek-frame__button-icon" viewBox="0 0 20 20" aria-hidden="true">
    <path class="streampeek-frame__icon-speaker" d="M9.25 4.5a.75.75 0 0 1 1.25.56v9.88a.75.75 0 0 1-1.28.53L6.57 12.5H4.5A1.5 1.5 0 0 1 3 11V9a1.5 1.5 0 0 1 1.5-1.5h2.07l2.68-2.97Z" />
    <path class="streampeek-frame__icon-wave" d="M13.23 7.22a.75.75 0 0 1 1.06 0 3.95 3.95 0 0 1 0 5.56.75.75 0 1 1-1.06-1.06 2.45 2.45 0 0 0 0-3.44.75.75 0 0 1 0-1.06Z" />
    <path class="streampeek-frame__icon-wave" d="M15.56 4.9a.75.75 0 0 1 1.06 0 7.23 7.23 0 0 1 0 10.2.75.75 0 1 1-1.06-1.06 5.73 5.73 0 0 0 0-8.08.75.75 0 0 1 0-1.06Z" />
    <path class="streampeek-frame__icon-muted" d="M5.35 5.35L14.65 14.65" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.9" />
  </svg>
`

const volumeInput = document.createElement('input')
volumeInput.className = 'streampeek-frame__volume'
volumeInput.type = 'range'
volumeInput.min = '0'
volumeInput.max = '1'
volumeInput.step = '0.05'
volumeInput.value = '0'
volumeInput.setAttribute('aria-label', 'Preview volume')

const volumeShell = document.createElement('div')
volumeShell.className = 'streampeek-frame__volume-shell'
volumeShell.append(volumeInput)

const pausedOverlay = document.createElement('div')
pausedOverlay.className = 'streampeek-frame__paused-overlay'
pausedOverlay.setAttribute('aria-hidden', 'true')
pausedOverlay.innerHTML = `
  <div class="streampeek-frame__paused-button">
    <svg class="streampeek-frame__paused-icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M7.25 5.72a.75.75 0 0 1 1.16-.63l6 4.28a.75.75 0 0 1 0 1.22l-6 4.28A.75.75 0 0 1 7.25 14V5.72Z" />
    </svg>
  </div>
`

const errorCard = document.createElement('div')
errorCard.className = 'streampeek-frame__error'
errorCard.hidden = true
errorCard.setAttribute('aria-label', 'Preview unavailable')
errorCard.innerHTML = `
  <svg class="streampeek-frame__error-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2.75a9.25 9.25 0 1 0 0 18.5a9.25 9.25 0 0 0 0-18.5Zm-4.03 5.9a.75.75 0 0 1 1.06 0l.97.97l.97-.97a.75.75 0 1 1 1.06 1.06l-.97.97l.97.97a.75.75 0 0 1-1.06 1.06l-.97-.97l-.97.97a.75.75 0 1 1-1.06-1.06l.97-.97l-.97-.97a.75.75 0 0 1 0-1.06Zm8 0a.75.75 0 0 1 1.06 0l.97.97l.97-.97a.75.75 0 1 1 1.06 1.06l-.97.97l.97.97a.75.75 0 0 1-1.06 1.06l-.97-.97l-.97.97a.75.75 0 1 1-1.06-1.06l.97-.97l-.97-.97a.75.75 0 0 1 0-1.06ZM8.4 16.3a.75.75 0 0 1 .73-.6h5.74a.75.75 0 0 1 0 1.5H9.13a.75.75 0 0 1-.73-.9Z" />
  </svg>
`
controls.append(muteButton, volumeInput)
controls.replaceChildren(muteButton, volumeShell)
shell.append(video, pausedOverlay, controls, errorCard)
root.append(shell)

const url = new URL(window.location.href)
const expectedSessionId = url.searchParams.get('session') ?? ''
const parentOrigin = document.referrer ? new URL(document.referrer).origin : 'https://www.twitch.tv'
const DEFAULT_UNMUTED_VOLUME = 0.35

let playerTitle = 'Live preview'
let hls: Hls | null = null
let audioState: PreviewAudioState = {
  muted: true,
  volume: 0,
  lastNonZeroVolume: DEFAULT_UNMUTED_VOLUME,
}
let activationToken = 0
let isAdjustingVolume = false

function canRestoreAudioAutomatically(): boolean {
  return navigator.userActivation?.hasBeenActive ?? false
}

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) {
    return 0
  }

  return Math.min(Math.max(volume, 0), 1)
}

function isPreviewAudioState(value: unknown): value is PreviewAudioState {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Partial<PreviewAudioState>

  return (
    typeof candidate.muted === 'boolean' &&
    typeof candidate.volume === 'number' &&
    (candidate.lastNonZeroVolume === undefined || typeof candidate.lastNonZeroVolume === 'number')
  )
}

function loadStoredAudioState(): Promise<PreviewAudioState> {
  return new Promise((resolve) => {
    chrome.storage.local.get(PREVIEW_AUDIO_STATE_STORAGE_KEY, (items) => {
      const storedValue = items[PREVIEW_AUDIO_STATE_STORAGE_KEY]

      if (!isPreviewAudioState(storedValue)) {
        resolve({
          muted: true,
          volume: 0,
          lastNonZeroVolume: DEFAULT_UNMUTED_VOLUME,
        })
        return
      }

      resolve({
        muted: storedValue.muted,
        volume: clampVolume(storedValue.volume),
        lastNonZeroVolume:
          clampVolume(storedValue.lastNonZeroVolume ?? storedValue.volume) || DEFAULT_UNMUTED_VOLUME,
      })
    })
  })
}

function saveAudioState(nextState: PreviewAudioState): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(
      {
        [PREVIEW_AUDIO_STATE_STORAGE_KEY]: nextState,
      },
      () => resolve(),
    )
  })
}

function applyAudioState(nextState: PreviewAudioState) {
  const normalizedVolume = clampVolume(nextState.volume)
  const normalizedLastNonZeroVolume =
    clampVolume(nextState.lastNonZeroVolume) ||
    (normalizedVolume > 0 ? normalizedVolume : audioState.lastNonZeroVolume || DEFAULT_UNMUTED_VOLUME)

  audioState = {
    muted: nextState.muted,
    volume: normalizedVolume,
    lastNonZeroVolume: normalizedLastNonZeroVolume,
  }

  video.volume = audioState.volume
  video.muted = audioState.muted
  volumeInput.value = String(audioState.volume)
  volumeInput.style.setProperty('--streampeek-volume-percent', `${audioState.volume * 100}%`)
  volumeShell.style.setProperty('--streampeek-volume-percent', `${audioState.volume * 100}%`)
}

function updateMuteState() {
  const isMuted = video.muted || video.volume === 0

  muteButton.dataset.state = isMuted ? 'muted' : 'unmuted'
  muteButton.setAttribute('aria-label', isMuted ? 'Unmute preview' : 'Mute preview')
}

function showError(message: string) {
  video.hidden = true
  controls.hidden = true
  errorCard.setAttribute('aria-label', `${playerTitle}: ${message}`)
  errorCard.hidden = false
}

function cleanupPlayer() {
  activationToken += 1
  hls?.destroy()
  hls = null
  video.pause()
  video.removeAttribute('src')
  video.load()
}

function resetPresentation() {
  video.hidden = false
  controls.hidden = false
  errorCard.hidden = true
  shell.dataset.playbackState = 'playing'
}

function persistAudioState() {
  void saveAudioState(audioState)
}

function getPreferredUnmuteVolume(): number {
  return clampVolume(audioState.lastNonZeroVolume) || DEFAULT_UNMUTED_VOLUME
}

function setVolumeLevel(nextVolume: number) {
  const normalizedVolume = clampVolume(nextVolume)

  applyAudioState({
    muted: normalizedVolume === 0,
    volume: normalizedVolume,
    lastNonZeroVolume: normalizedVolume > 0 ? normalizedVolume : getPreferredUnmuteVolume(),
  })

  updateMuteState()
  persistAudioState()
}

function setVolumeFromPointer(clientX: number) {
  const bounds = volumeShell.getBoundingClientRect()

  if (bounds.width <= 0) {
    return
  }

  const nextVolume = (clientX - bounds.left) / bounds.width
  setVolumeLevel(nextVolume)
}

function tryPlay() {
  void video.play().catch(() => {
    if (!video.muted && video.volume > 0) {
      video.muted = true
      updateMuteState()
      void video.play().catch(() => {
        showError('Autoplay was blocked for this hover preview.')
      })
      return
    }

    showError('Autoplay was blocked for this hover preview.')
  })
}

function togglePlayback() {
  if (video.paused) {
    tryPlay()
    return
  }

  video.pause()
}

muteButton.addEventListener('click', () => {
  const isCurrentlyMuted = video.muted || video.volume === 0

  if (isCurrentlyMuted) {
    const nextVolume = getPreferredUnmuteVolume()

    applyAudioState({
      muted: false,
      volume: nextVolume,
      lastNonZeroVolume: nextVolume,
    })

    if (video.paused) {
      tryPlay()
    }
  } else {
    applyAudioState({
      muted: true,
      volume: 0,
      lastNonZeroVolume: getPreferredUnmuteVolume(),
    })
  }

  updateMuteState()
  persistAudioState()
})

volumeInput.addEventListener('input', () => {
  setVolumeLevel(Number(volumeInput.value))
})

volumeShell.addEventListener('pointerdown', (event) => {
  isAdjustingVolume = true
  volumeShell.setPointerCapture(event.pointerId)
  setVolumeFromPointer(event.clientX)
})

volumeShell.addEventListener('pointermove', (event) => {
  if (!isAdjustingVolume) {
    return
  }

  setVolumeFromPointer(event.clientX)
})

const stopAdjustingVolume = (event: PointerEvent) => {
  if (!isAdjustingVolume) {
    return
  }

  isAdjustingVolume = false

  if (volumeShell.hasPointerCapture(event.pointerId)) {
    volumeShell.releasePointerCapture(event.pointerId)
  }
}

volumeShell.addEventListener('pointerup', stopAdjustingVolume)
volumeShell.addEventListener('pointercancel', stopAdjustingVolume)

shell.addEventListener('click', (event) => {
  const target = event.target

  if (!(target instanceof Node) || controls.contains(target)) {
    return
  }

  togglePlayback()
})

video.addEventListener('playing', () => {
  errorCard.hidden = true
  shell.dataset.playbackState = 'playing'
})

video.addEventListener('pause', () => {
  if (errorCard.hidden) {
    shell.dataset.playbackState = 'paused'
  }
})

async function initializePreview(message: PreviewFrameInitMessage) {
  if (message.sessionId !== expectedSessionId) {
    return
  }

  const requestToken = activationToken + 1
  cleanupPlayer()
  activationToken = requestToken
  playerTitle = message.title
  video.setAttribute('aria-label', `Live preview for ${message.title}`)
  resetPresentation()
  applyAudioState(await loadStoredAudioState())

  if (activationToken !== requestToken) {
    return
  }

  const shouldForceMutedAutoplay =
    !audioState.muted && audioState.volume > 0 && !canRestoreAudioAutomatically()

  if (shouldForceMutedAutoplay) {
    video.muted = true
  }

  updateMuteState()

  try {
    const source = await resolvePlaybackSource(message.channel)

    if (activationToken !== requestToken) {
      return
    }

    if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
      })

      hls.attachMedia(video)
      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        if (activationToken !== requestToken) {
          return
        }

        hls?.loadSource(source.playlistUrl)
      })
      hls.on(Hls.Events.MANIFEST_PARSED, tryPlay)
      hls.on(Hls.Events.ERROR, (_event, data: ErrorData) => {
        if (activationToken !== requestToken) {
          return
        }

        if (!data.fatal) {
          return
        }

        showError('The preview stream could not be loaded in the hover player.')
      })
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = source.playlistUrl
      video.load()
      tryPlay()
    } else {
      showError('This browser cannot play HLS previews inside the hover frame.')
    }
  } catch {
    if (activationToken === requestToken) {
      showError('The preview stream could not be started for this channel.')
    }
  }
}

function stopPreview(message: PreviewFrameStopMessage) {
  if (message.sessionId !== expectedSessionId) {
    return
  }

  cleanupPlayer()
  video.hidden = true
  controls.hidden = true
  errorCard.hidden = true
}

window.addEventListener('message', (event) => {
  if (event.origin !== parentOrigin) {
    return
  }

  const message = event.data as PreviewFrameMessage

  if (isInitMessage(message)) {
    void initializePreview(message)
    return
  }

  if (isStopMessage(message)) {
    stopPreview(message)
  }
})

const readyMessage: PreviewFrameReadyMessage = {
  type: 'streampeek:ready',
  sessionId: expectedSessionId,
}

window.parent.postMessage(readyMessage, parentOrigin)
window.addEventListener('pagehide', cleanupPlayer, { once: true })
updateMuteState()
