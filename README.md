# YouTube Highest Quality

A tiny unpacked Chrome extension that keeps YouTube videos on the highest available quality.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `/Users/ben/Desktop/yt-hq-spd`.

## How it works

- Runs only on `youtube.com` and `youtube-nocookie.com`.
- Uses YouTube's own player quality methods from the page context.
- Applies quality in short bursts around navigation/video-load events, then checks every 12 seconds.
- Has no background service worker, popup, storage, analytics, network calls, or dependencies.
