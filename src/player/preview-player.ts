import type {
  PreviewFrameInitMessage,
  PreviewFrameParentMessage,
  PreviewFrameReadyMessage,
  PreviewFrameStopMessage,
  PreviewRenderable,
} from '../shared/types'

interface CreatePreviewPlayerOptions {
  authToken?: string
  channel: string
  title: string
  onFatalError: () => void
}

interface SharedPreviewFrame {
  iframe: HTMLIFrameElement
  parkingHost: HTMLDivElement
  root: HTMLDivElement
  sessionId: string
}

const PREVIEW_FRAME_ORIGIN = new URL(chrome.runtime.getURL('')).origin

let sharedFrame: SharedPreviewFrame | null = null
let isFrameReady = false
let loadTimeoutId: number | null = null
let pendingInitMessage: PreviewFrameInitMessage | null = null
let fatalErrorHandler: (() => void) | null = null

function postToFrame(message: PreviewFrameInitMessage | PreviewFrameStopMessage) {
  sharedFrame?.iframe.contentWindow?.postMessage(message, '*')
}

function clearLoadTimeout() {
  if (loadTimeoutId !== null) {
    window.clearTimeout(loadTimeoutId)
    loadTimeoutId = null
  }
}

function resetSharedFrame() {
  clearLoadTimeout()
  pendingInitMessage = null
  fatalErrorHandler = null
  isFrameReady = false
  sharedFrame?.root.remove()
  sharedFrame?.parkingHost.remove()
  sharedFrame = null
}

function triggerFatalError() {
  const handler = fatalErrorHandler
  resetSharedFrame()
  handler?.()
}

function ensureParkingHost(): HTMLDivElement {
  if (sharedFrame) {
    return sharedFrame.parkingHost
  }

  const parkingHost = document.createElement('div')
  parkingHost.setAttribute('aria-hidden', 'true')
  Object.assign(parkingHost.style, {
    height: '1px',
    left: '-9999px',
    opacity: '0',
    overflow: 'hidden',
    pointerEvents: 'none',
    position: 'fixed',
    top: '0',
    width: '1px',
  })

  document.body.append(parkingHost)
  return parkingHost
}

function isReadyMessage(value: unknown): value is PreviewFrameReadyMessage {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Partial<PreviewFrameParentMessage>

  return candidate.type === 'streampeek:ready' && typeof candidate.sessionId === 'string'
}

window.addEventListener('message', (event) => {
  if (event.origin !== PREVIEW_FRAME_ORIGIN || !sharedFrame || event.source !== sharedFrame.iframe.contentWindow) {
    return
  }

  if (isReadyMessage(event.data) && event.data.sessionId === sharedFrame.sessionId) {
    isFrameReady = true
    clearLoadTimeout()

    if (pendingInitMessage) {
      postToFrame(pendingInitMessage)
    }

    return
  }
})

function ensureSharedFrame(): SharedPreviewFrame {
  if (sharedFrame) {
    return sharedFrame
  }

  const parkingHost = ensureParkingHost()
  const root = document.createElement('div')
  root.className = 'streampeek-player'

  const sessionId = crypto.randomUUID()
  const iframe = document.createElement('iframe')
  iframe.className = 'streampeek-iframe'
  iframe.src = `${chrome.runtime.getURL('preview-frame.html')}?session=${encodeURIComponent(sessionId)}`
  iframe.title = ''
  iframe.setAttribute('aria-label', 'Stream preview')
  iframe.loading = 'eager'
  iframe.referrerPolicy = 'no-referrer'

  const onError = () => {
    triggerFatalError()
  }

  loadTimeoutId = window.setTimeout(() => {
    triggerFatalError()
  }, 5_000)

  iframe.addEventListener('error', onError)
  root.append(iframe)
  parkingHost.append(root)

  sharedFrame = {
    iframe,
    parkingHost,
    root,
    sessionId,
  }

  return sharedFrame
}

export function createPreviewPlayer(options: CreatePreviewPlayerOptions): PreviewRenderable {
  const frame = ensureSharedFrame()

  fatalErrorHandler = options.onFatalError
  frame.iframe.setAttribute('aria-label', `${options.channel} preview`)

  const message: PreviewFrameInitMessage = {
    type: 'streampeek:init',
    sessionId: frame.sessionId,
    authToken: options.authToken,
    channel: options.channel,
    title: options.title,
  }

  pendingInitMessage = message

  if (isFrameReady) {
    postToFrame(message)
  }

  return {
    element: frame.root,
    dispose: () => {
      if (sharedFrame !== frame) {
        return
      }

      pendingInitMessage = null
      fatalErrorHandler = null
      frame.parkingHost.append(frame.root)

      if (isFrameReady) {
        const stopMessage: PreviewFrameStopMessage = {
          type: 'streampeek:stop',
          sessionId: frame.sessionId,
        }

        postToFrame(stopMessage)
      }
    },
  }
}
