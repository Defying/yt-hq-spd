(() => {
  "use strict";

  const qualityEventName = "yt-hq-preferred-quality";
  const speedEventName = "yt-hq-playback-speed";
  const saveSpeedEventName = "yt-hq-save-playback-speed";
  const qualityAttributeName = "data-yt-hq-preferred-quality";
  const speedAttributeName = "data-yt-hq-playback-speed";
  const previousSpeedAttributeName = "data-yt-hq-previous-playback-speed";
  const qualityStorageKey = "preferredQuality";
  const speedStorageKey = "playbackSpeed";
  const previousSpeedStorageKey = "previousPlaybackSpeed";
  const defaultQuality = "highest";
  const defaultSpeed = 1;
  const speedMin = 0.25;
  const speedMax = 4;
  const speedStep = 0.05;

  function emitPreferredQuality(quality) {
    const preferredQuality = quality || defaultQuality;
    document.documentElement.setAttribute(qualityAttributeName, preferredQuality);
    window.dispatchEvent(new Event(qualityEventName));
  }

  function normalizeSpeed(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return defaultSpeed;
    }

    const steppedValue = Math.round(numericValue / speedStep) * speedStep;
    return Number(Math.min(speedMax, Math.max(speedMin, steppedValue)).toFixed(2));
  }

  function isNormalSpeed(value) {
    return Math.abs(normalizeSpeed(value) - defaultSpeed) < 0.001;
  }

  function normalizePreviousSpeed(value, fallbackSpeed) {
    const previousSpeed = normalizeSpeed(value);
    if (!isNormalSpeed(previousSpeed)) {
      return previousSpeed;
    }

    const fallback = normalizeSpeed(fallbackSpeed);
    return isNormalSpeed(fallback) ? defaultSpeed : fallback;
  }

  function emitPlaybackSpeed(speed, previousSpeed) {
    const playbackSpeed = normalizeSpeed(speed);
    const rememberedSpeed = normalizePreviousSpeed(previousSpeed, playbackSpeed);
    document.documentElement.setAttribute(speedAttributeName, String(playbackSpeed));
    document.documentElement.setAttribute(
      previousSpeedAttributeName,
      String(rememberedSpeed)
    );
    window.dispatchEvent(new Event(speedEventName));
  }

  chrome.storage.sync.get({
    [qualityStorageKey]: defaultQuality,
    [speedStorageKey]: defaultSpeed,
    [previousSpeedStorageKey]: defaultSpeed
  }, (items) => {
    emitPreferredQuality(items[qualityStorageKey]);
    emitPlaybackSpeed(items[speedStorageKey], items[previousSpeedStorageKey]);
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") {
      return;
    }

    if (changes[qualityStorageKey]) {
      emitPreferredQuality(changes[qualityStorageKey].newValue);
    }

    if (changes[speedStorageKey]) {
      emitPlaybackSpeed(
        changes[speedStorageKey].newValue,
        document.documentElement.getAttribute(previousSpeedAttributeName)
      );
    }

    if (changes[previousSpeedStorageKey]) {
      emitPlaybackSpeed(
        document.documentElement.getAttribute(speedAttributeName),
        changes[previousSpeedStorageKey].newValue
      );
    }
  });

  window.addEventListener(saveSpeedEventName, () => {
    const playbackSpeed = normalizeSpeed(
      document.documentElement.getAttribute(speedAttributeName)
    );
    const rememberedSpeed = normalizePreviousSpeed(
      document.documentElement.getAttribute(previousSpeedAttributeName),
      playbackSpeed
    );

    chrome.storage.sync.set({
      [speedStorageKey]: playbackSpeed,
      [previousSpeedStorageKey]: rememberedSpeed
    });
  });
})();
