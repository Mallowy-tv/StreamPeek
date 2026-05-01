import type { PlaybackSource } from '../shared/types'

const TWITCH_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko'
const PLAYBACK_ACCESS_QUERY = `
  query PlaybackAccessToken_Template(
    $login: String!
    $isLive: Boolean!
    $vodID: ID!
    $isVod: Boolean!
    $playerType: String!
  ) {
    streamPlaybackAccessToken(
      channelName: $login
      params: { platform: "web", playerBackend: "mediaplayer", playerType: $playerType }
    ) @include(if: $isLive) {
      value
      signature
      __typename
    }
    videoPlaybackAccessToken(
      id: $vodID
      params: { platform: "web", playerBackend: "mediaplayer", playerType: $playerType }
    ) @include(if: $isVod) {
      value
      signature
      __typename
    }
  }
`

interface PlaybackAccessTokenResponse {
  data?: {
    streamPlaybackAccessToken?: {
      value: string
      signature: string
    }
  }
}

interface ParsedPlaybackToken {
  expires?: number
}

const playbackCache = new Map<string, PlaybackSource>()

function buildPlaylistUrl(channel: string, token: string, signature: string): string {
  const playlistUrl = new URL(`https://usher.ttvnw.net/api/channel/hls/${channel}.m3u8`)

  playlistUrl.searchParams.set('allow_audio_only', 'true')
  playlistUrl.searchParams.set('allow_source', 'true')
  playlistUrl.searchParams.set('client_id', TWITCH_CLIENT_ID)
  playlistUrl.searchParams.set('fast_bread', 'true')
  playlistUrl.searchParams.set('player', 'twitchweb')
  playlistUrl.searchParams.set('player_backend', 'mediaplayer')
  playlistUrl.searchParams.set('playlist_include_framerate', 'true')
  playlistUrl.searchParams.set('reassignments_supported', 'true')
  playlistUrl.searchParams.set('sig', signature)
  playlistUrl.searchParams.set('supported_codecs', 'av1,h264')
  playlistUrl.searchParams.set('token', token)
  playlistUrl.searchParams.set('type', 'any')
  playlistUrl.searchParams.set('p', String(Math.floor(Math.random() * 1_000_000)))

  return playlistUrl.toString()
}

function readCachedSource(channel: string): PlaybackSource | null {
  const cachedSource = playbackCache.get(channel)

  if (!cachedSource) {
    return null
  }

  if (Date.now() + 60_000 < cachedSource.expiresAt) {
    return cachedSource
  }

  playbackCache.delete(channel)

  return null
}

export async function resolvePlaybackSource(channel: string): Promise<PlaybackSource> {
  const cachedSource = readCachedSource(channel)

  if (cachedSource) {
    return cachedSource
  }

  const response = await fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Client-ID': TWITCH_CLIENT_ID,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operationName: 'PlaybackAccessToken_Template',
      query: PLAYBACK_ACCESS_QUERY,
      variables: {
        isLive: true,
        isVod: false,
        login: channel,
        playerType: 'site',
        vodID: '',
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`Playback token request failed with status ${response.status}`)
  }

  const payload = (await response.json()) as PlaybackAccessTokenResponse
  const accessToken = payload.data?.streamPlaybackAccessToken

  if (!accessToken?.value || !accessToken.signature) {
    throw new Error(`No playback token returned for ${channel}`)
  }

  const parsedToken = JSON.parse(accessToken.value) as ParsedPlaybackToken
  const expiresAt = (parsedToken.expires ?? Math.floor(Date.now() / 1000) + 300) * 1000

  const source = {
    channel,
    expiresAt,
    playlistUrl: buildPlaylistUrl(channel, accessToken.value, accessToken.signature),
  }

  playbackCache.set(channel, source)

  return source
}
