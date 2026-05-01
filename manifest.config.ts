import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  name: 'StreamPeek',
  description: 'Hover Twitch live cards to watch muted stream previews with quick audio controls.',
  version: '0.0.1',
  action: {
    default_title: 'StreamPeek',
  },
  permissions: ['storage'],
  host_permissions: [
    'https://www.twitch.tv/*',
    'https://gql.twitch.tv/*',
    'https://*.ttvnw.net/*',
  ],
  content_scripts: [
    {
      matches: ['https://www.twitch.tv/*'],
      js: ['src/content/main.ts'],
      run_at: 'document_idle',
    },
  ],
  web_accessible_resources: [
    {
      matches: ['https://www.twitch.tv/*'],
      resources: [
        'preview-frame.html',
        'assets/previewFrame-*.js',
        'assets/previewFrame-*.css',
        'assets/modulepreload-*.js',
      ],
    },
  ],
  icons: {
    '16': 'icons/icon-16.png',
    '32': 'icons/icon-32.png',
    '48': 'icons/icon-48.png',
    '128': 'icons/icon-128.png',
  },
})
