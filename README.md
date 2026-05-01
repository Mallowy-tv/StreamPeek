# 👀 StreamPeek

> Hover Twitch channels to watch instant live previews without opening the stream.

## ✨ Introduction

StreamPeek is a Chrome extension for Twitch that lets you preview live channels directly from the page while you browse. Instead of opening multiple streams just to see what is happening, you can hover a live channel and get a lightweight video preview with compact audio controls.

StreamPeek currently supports:

- Hover previews on Twitch directory cards
- Hover previews on left-side live channel entries
- Compact mute and volume controls
- Remembered volume and mute preferences
- Click-to-pause and resume preview playback

## 🧩 Install in Chrome

1. Download and unzip the StreamPeek extension files.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** in the top-right corner.
4. Click **Load unpacked**.
5. Select the StreamPeek extension folder you downloaded. If your download contains a `dist` folder, select `dist`.
6. Make sure the StreamPeek toggle is enabled after Chrome loads it.

## 👀 How to use StreamPeek

1. Open Twitch in Chrome.
2. Browse a category page, directory page, or the left sidebar with live channels.
3. Hover a live stream card or supported live channel entry.
4. Wait a moment for the preview to load.
5. Use the speaker control to mute, unmute, or adjust volume.
6. Click the preview to pause or resume playback.

## ⚡ What to expect

- Previews are designed to start quickly and stay lightweight.
- Audio settings are remembered between previews.
- Some previews may start muted first because of Chrome autoplay rules.
- If a preview cannot be loaded, StreamPeek shows a simple unavailable state instead of opening the full Twitch player.

## 🔐 Permissions

StreamPeek needs access to Twitch pages so it can detect live channels and show previews where you hover them. It also uses local storage to remember your audio settings.

### ❌ The preview does not load

- Refresh the Twitch page once after enabling the extension.
- Make sure you are on `https://www.twitch.tv/`.
- Try hovering a live channel instead of an offline one.

### 🔊 Audio does not start right away

Chrome can block autoplay with sound. If that happens, unmute the preview manually once and continue browsing.

### 🧩 The extension does not appear in Chrome

- Confirm **Developer mode** is enabled on `chrome://extensions`.
- Reload the extension from the extensions page.
- If you loaded the wrong folder, remove it and load the correct StreamPeek folder again.

## 📄 License

No license has been added to this repository yet.
