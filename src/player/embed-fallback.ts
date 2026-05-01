import type { PreviewRenderable } from '../shared/types'

interface CreateEmbedFallbackOptions {
  channel: string
}

export function createEmbedFallback(options: CreateEmbedFallbackOptions): PreviewRenderable {
  const root = document.createElement('div')
  root.className = 'streampeek-player streampeek-player--fallback'

  const badge = document.createElement('div')
  badge.className = 'streampeek-badge streampeek-badge--fallback'
  badge.textContent = 'Preview unavailable'

  const body = document.createElement('div')
  body.className = 'streampeek-fallback-body'

  const title = document.createElement('p')
  title.className = 'streampeek-fallback-title'
  title.textContent = options.channel

  const message = document.createElement('p')
  message.className = 'streampeek-fallback-message'
  message.textContent = 'The lightweight preview could not start on this hover. Open the stream to continue watching.'

  body.append(title, message)
  root.append(body, badge)

  return {
    element: root,
    dispose: () => {
      root.remove()
    },
  }
}
