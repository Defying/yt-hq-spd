# YouTube Quality Keeper

A tiny unpacked Chrome extension that keeps YouTube videos on your preferred quality and playback speed, plus optional OpenAI-powered transcript summaries.

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
- Syncs speed changes made with YouTube's own player controls back into the extension settings.
- Can record the current YouTube video's audio in real time, transcribe it with `gpt-4o-transcribe`, summarize it with `gpt-5.2`, and save it in a local IndexedDB library.
- Saves your preferred quality and playback speed in Chrome sync storage.
- Stores your OpenAI API key only in local Chrome extension storage; it is not committed to this repo.
- Applies quality in short bursts around navigation/video-load events, then checks every 12 seconds.
- Has no analytics, third-party dependencies, or network calls except the OpenAI API when you explicitly run transcript analysis.

## Transcript summaries

1. Open the extension popup.
2. Save your OpenAI API key.
3. Open a YouTube video and click **Analyze current video**.
4. Keep the tab open while the extension records the video's audio at `1x`.
5. Open **Library** from the popup to read saved summaries, section breakdowns, terms, and transcripts.

Chrome extensions cannot directly extract YouTube's protected audio file from the page, so analysis records the playing video audio in real time.
