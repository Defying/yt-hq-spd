(() => {
  "use strict";

  const installKey = "__ytHighestQualityInstalled";
  if (window[installKey]) {
    return;
  }
  Object.defineProperty(window, installKey, { value: true });

  const fallbackQuality = "highres";
  const burstDelays = [0, 250, 800, 1800, 3500];
  const watchdogMs = 12000;
  const qualityScores = {
    highres: 100000,
    hd4320: 4320,
    hd2880: 2880,
    hd2160: 2160,
    hd1440: 1440,
    hd1080: 1080,
    hd720: 720,
    large: 480,
    medium: 360,
    small: 240,
    tiny: 144,
    auto: -1
  };

  let burstToken = 0;
  let lastBurstAt = 0;
  let lastAppliedAt = 0;
  let lastAppliedHref = "";
  let lastAppliedQuality = "";
  let lastHref = "";
  let playerNode = null;
  let videoNode = null;
  let videoEvents = null;

  function scoreQuality(quality) {
    if (!quality) {
      return -1;
    }

    if (quality in qualityScores) {
      return qualityScores[quality];
    }

    const numericHeight = /^hd(\d+)$/i.exec(quality);
    return numericHeight ? Number(numericHeight[1]) : 0;
  }

  function findPlayer() {
    return (
      document.getElementById("movie_player") ||
      document.querySelector(".html5-video-player")
    );
  }

  function findVideo(player) {
    return (
      (player && player.querySelector("video")) ||
      document.querySelector("video")
    );
  }

  function getAvailableQualities(player) {
    try {
      if (player && typeof player.getAvailableQualityLevels === "function") {
        return Array.from(player.getAvailableQualityLevels() || []);
      }
    } catch (_) {
      // YouTube can briefly expose player methods before their internals are ready.
    }

    return [];
  }

  function getCurrentQuality(player) {
    try {
      if (player && typeof player.getPlaybackQuality === "function") {
        return player.getPlaybackQuality() || "";
      }
    } catch (_) {
      // Ignore transient player state during navigation.
    }

    return "";
  }

  function chooseBestQuality(qualities) {
    const ranked = qualities
      .filter((quality) => quality && quality !== "auto")
      .sort((left, right) => scoreQuality(right) - scoreQuality(left));

    return ranked[0] || fallbackQuality;
  }

  function callPlayerSetter(player, method, quality) {
    try {
      if (typeof player[method] === "function") {
        player[method](quality, quality);
      }
    } catch (_) {
      // Some page transitions leave stale player objects around for a moment.
    }
  }

  function applyHighestQuality() {
    const player = findPlayer();
    if (!player) {
      return;
    }

    const bestQuality = chooseBestQuality(getAvailableQualities(player));
    const currentQuality = getCurrentQuality(player);
    const now = Date.now();

    if (
      currentQuality === bestQuality &&
      lastAppliedHref === location.href &&
      lastAppliedQuality === bestQuality &&
      now - lastAppliedAt < watchdogMs
    ) {
      return;
    }

    callPlayerSetter(player, "setPlaybackQualityRange", bestQuality);
    callPlayerSetter(player, "setPlaybackQuality", bestQuality);

    lastAppliedAt = now;
    lastAppliedHref = location.href;
    lastAppliedQuality = bestQuality;
  }

  function scheduleBurst(force = false) {
    const now = performance.now();
    if (!force && now - lastBurstAt < 350) {
      return;
    }

    lastBurstAt = now;
    const token = ++burstToken;

    for (const delay of burstDelays) {
      window.setTimeout(() => {
        if (token === burstToken) {
          bindPlayerAndVideo();
          applyHighestQuality();
        }
      }, delay);
    }
  }

  function bindPlayerAndVideo() {
    const player = findPlayer();
    if (player !== playerNode) {
      playerNode = player;
      scheduleBurst(true);
    }

    const video = findVideo(player);
    if (!video || video === videoNode) {
      return;
    }

    if (videoEvents) {
      videoEvents.abort();
    }

    videoNode = video;
    videoEvents = new AbortController();

    for (const eventName of [
      "loadstart",
      "loadedmetadata",
      "canplay",
      "play",
      "playing",
      "durationchange",
      "emptied"
    ]) {
      video.addEventListener(eventName, () => scheduleBurst(true), {
        passive: true,
        signal: videoEvents.signal
      });
    }

    video.addEventListener("resize", () => scheduleBurst(), {
      passive: true,
      signal: videoEvents.signal
    });

    scheduleBurst(true);
  }

  function handlePossibleNavigation() {
    if (lastHref !== location.href) {
      lastHref = location.href;
      lastAppliedAt = 0;
      lastAppliedHref = "";
      lastAppliedQuality = "";
      scheduleBurst(true);
    }
  }

  function startDomWatcher() {
    const root = document.documentElement;
    if (!root) {
      window.setTimeout(startDomWatcher, 50);
      return;
    }

    let queued = false;
    const observer = new MutationObserver(() => {
      if (queued) {
        return;
      }

      queued = true;
      window.requestAnimationFrame(() => {
        queued = false;
        handlePossibleNavigation();
        bindPlayerAndVideo();
      });
    });

    observer.observe(root, { childList: true, subtree: true });
  }

  for (const eventName of [
    "DOMContentLoaded",
    "pageshow",
    "popstate",
    "hashchange",
    "yt-navigate-start",
    "yt-navigate-finish",
    "yt-page-data-updated",
    "yt-player-updated"
  ]) {
    window.addEventListener(eventName, () => {
      handlePossibleNavigation();
      scheduleBurst(true);
    }, { passive: true });
  }

  window.setInterval(() => {
    handlePossibleNavigation();
    bindPlayerAndVideo();
    applyHighestQuality();
  }, watchdogMs);

  lastHref = location.href;
  startDomWatcher();
  scheduleBurst(true);
})();
