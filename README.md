# YouTube Quality Keeper

A tiny unpacked Chrome extension that keeps YouTube videos on your preferred quality and playback speed.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `/Users/ben/Desktop/yt-hq-spd`.
5. Pin the extension from Chrome's extensions menu if you want quick access.

## How it works

- Runs only on `youtube.com` and `youtube-nocookie.com`.
- Uses YouTube's own player quality methods from the page context.
- Adds a compact hover overlay in the top-right of the video for 0.05x speed steps and a speed slider.
- Includes both quality and speed controls in the pinned extension popup.
- Adds a one-shot `1x` toggle that remembers and restores your last non-normal speed.
- Saves your preferred quality and playback speed in Chrome sync storage.
- Applies quality in short bursts around navigation/video-load events, then checks every 12 seconds.
- Has no background service worker, analytics, network calls, or dependencies.
