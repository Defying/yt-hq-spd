(() => {
  "use strict";

  const installKey = "__ytHighestQualityInstalled";
  if (window[installKey]) {
    return;
  }
  Object.defineProperty(window, installKey, { value: true });

  const defaultPreferredQuality = "highest";
  const defaultPlaybackSpeed = 1;
  const fallbackQuality = "highres";
  const settingsEvent = "yt-hq-preferred-quality";
  const speedEvent = "yt-hq-playback-speed";
  const saveSpeedEvent = "yt-hq-save-playback-speed";
  const settingsAttribute = "data-yt-hq-preferred-quality";
  const speedAttribute = "data-yt-hq-playback-speed";
  const previousSpeedAttribute = "data-yt-hq-previous-playback-speed";
  const overlayId = "yt-hq-speed-overlay";
  const styleId = "yt-hq-speed-style";
  const overlayVisibleClass = "yt-hq-speed-overlay-visible";
  const burstDelays = [0, 250, 800, 1800, 3500];
  const watchdogMs = 12000;
  const overlayIdleMs = 1700;
  const normalSpeed = 1;
  const speedMin = 0.25;
  const speedMax = 4;
  const speedStep = 0.05;
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
  let preferredQuality = defaultPreferredQuality;
  let preferredSpeed = defaultPlaybackSpeed;
  let previousPlaybackSpeed = defaultPlaybackSpeed;
  let playerNode = null;
  let videoNode = null;
  let videoEvents = null;
  let speedOverlay = null;
  let speedReadout = null;
  let speedSlider = null;
  let normalToggleButton = null;
  let speedSaveTimer = 0;
  let speedOverlayHideTimer = 0;
  let playerOverlayEvents = null;
  let playerPointerInside = false;
  let overlayPointerInside = false;
  let overlayFocusInside = false;

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

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function normalizeSpeed(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return defaultPlaybackSpeed;
    }

    const steppedValue = Math.round(numericValue / speedStep) * speedStep;
    return Number(clamp(steppedValue, speedMin, speedMax).toFixed(2));
  }

  function formatSpeed(value) {
    return `${normalizeSpeed(value).toFixed(2)}x`;
  }

  function isNormalSpeed(value) {
    return Math.abs(normalizeSpeed(value) - normalSpeed) < 0.001;
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

  function choosePreferredQuality(qualities) {
    if (preferredQuality === "highest") {
      return chooseBestQuality(qualities);
    }

    const ranked = qualities
      .filter((quality) => quality && quality !== "auto")
      .sort((left, right) => scoreQuality(right) - scoreQuality(left));

    if (ranked.includes(preferredQuality)) {
      return preferredQuality;
    }

    const preferredScore = scoreQuality(preferredQuality);
    const lowerOrEqual = ranked.find(
      (quality) => scoreQuality(quality) <= preferredScore
    );

    return lowerOrEqual || ranked[ranked.length - 1] || fallbackQuality;
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

    const bestQuality = choosePreferredQuality(getAvailableQualities(player));
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

  function applyPreferredSpeed() {
    const video = videoNode || findVideo(playerNode);
    if (!video) {
      return;
    }

    const targetSpeed = normalizeSpeed(preferredSpeed);
    if (Math.abs(video.playbackRate - targetSpeed) < 0.001) {
      return;
    }

    try {
      video.playbackRate = targetSpeed;
    } catch (_) {
      // Browser media controls can reject rates on transient media elements.
    }
  }

  function updateSpeedOverlay() {
    if (speedReadout) {
      speedReadout.textContent = formatSpeed(preferredSpeed);
    }

    if (speedSlider) {
      speedSlider.value = String(normalizeSpeed(preferredSpeed));
      speedSlider.setAttribute("aria-valuetext", formatSpeed(preferredSpeed));
    }

    if (normalToggleButton) {
      const normal = isNormalSpeed(preferredSpeed);
      const canRestore = !isNormalSpeed(previousPlaybackSpeed);
      const toggleLabel = normal && canRestore
        ? `Restore ${formatSpeed(previousPlaybackSpeed)}`
        : "Use 1.00x";
      normalToggleButton.textContent = "1x";
      normalToggleButton.title = toggleLabel;
      normalToggleButton.setAttribute(
        "aria-label",
        normal && canRestore
          ? toggleLabel
          : "Temporarily use 1.00x"
      );
      normalToggleButton.setAttribute("aria-pressed", String(normal));
    }
  }

  function rememberPlaybackSpeed(value) {
    const speed = normalizeSpeed(value);
    if (isNormalSpeed(speed)) {
      return;
    }

    previousPlaybackSpeed = speed;
    document.documentElement.setAttribute(previousSpeedAttribute, String(speed));
    updateSpeedOverlay();
  }

  function persistPreferredSpeed() {
    window.clearTimeout(speedSaveTimer);
    speedSaveTimer = window.setTimeout(() => {
      document.documentElement.setAttribute(
        speedAttribute,
        String(normalizeSpeed(preferredSpeed))
      );
      document.documentElement.setAttribute(
        previousSpeedAttribute,
        String(normalizeSpeed(previousPlaybackSpeed))
      );
      window.dispatchEvent(new Event(saveSpeedEvent));
    }, 120);
  }

  function setPreferredSpeed(value, persist = false, remember = true) {
    const nextSpeed = normalizeSpeed(value);
    const changed = Math.abs(preferredSpeed - nextSpeed) >= 0.001;

    if (remember) {
      rememberPlaybackSpeed(nextSpeed);
    }

    preferredSpeed = nextSpeed;
    document.documentElement.setAttribute(speedAttribute, String(nextSpeed));
    updateSpeedOverlay();
    applyPreferredSpeed();

    if (persist && changed) {
      persistPreferredSpeed();
    }
  }

  function stepPreferredSpeed(direction) {
    setPreferredSpeed(preferredSpeed + direction * speedStep, true);
  }

  function toggleNormalSpeed() {
    if (isNormalSpeed(preferredSpeed)) {
      if (!isNormalSpeed(previousPlaybackSpeed)) {
        setPreferredSpeed(previousPlaybackSpeed, true);
      }
      return;
    }

    rememberPlaybackSpeed(preferredSpeed);
    setPreferredSpeed(normalSpeed, true, false);
  }

  function clearSpeedOverlayFade() {
    window.clearTimeout(speedOverlayHideTimer);
  }

  function hideSpeedOverlay() {
    clearSpeedOverlayFade();

    if (speedOverlay) {
      speedOverlay.classList.remove(overlayVisibleClass);
    }
  }

  function scheduleSpeedOverlayFade() {
    clearSpeedOverlayFade();
    speedOverlayHideTimer = window.setTimeout(() => {
      if (!overlayPointerInside && !overlayFocusInside) {
        hideSpeedOverlay();
      }
    }, overlayIdleMs);
  }

  function showSpeedOverlay(player = playerNode, fadeAfterIdle = true) {
    if (!player) {
      return;
    }

    bindSpeedOverlay(player);

    if (speedOverlay) {
      speedOverlay.classList.add(overlayVisibleClass);
    }

    if (fadeAfterIdle && !overlayPointerInside && !overlayFocusInside) {
      scheduleSpeedOverlayFade();
      return;
    }

    clearSpeedOverlayFade();
  }

  function restoreSpeedOverlayFade() {
    if (overlayPointerInside || overlayFocusInside) {
      return;
    }

    if (playerPointerInside) {
      scheduleSpeedOverlayFade();
      return;
    }

    hideSpeedOverlay();
  }

  function pointerIsInPlayer(event, player = playerNode) {
    if (!player || typeof event.clientX !== "number") {
      return false;
    }

    const rect = player.getBoundingClientRect();
    return (
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom
    );
  }

  function handleGlobalPointerActivity(event) {
    bindPlayerAndVideo();

    if (!playerNode) {
      return;
    }

    if (pointerIsInPlayer(event)) {
      playerPointerInside = true;
      showSpeedOverlay(playerNode, true);
      return;
    }

    playerPointerInside = false;

    if (!overlayPointerInside && !overlayFocusInside) {
      hideSpeedOverlay();
    }
  }

  function injectSpeedStyles() {
    if (document.getElementById(styleId)) {
      return;
    }

    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      #${overlayId} {
        position: absolute;
        top: 12px;
        right: 12px;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 7px 8px;
        border-radius: 8px;
        color: #fff;
        background: rgba(0, 0, 0, 0.72);
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);
        font: 12px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        opacity: 0;
        pointer-events: none;
        transform: translateY(-4px);
        transition: opacity 120ms ease, transform 120ms ease;
      }

      #${overlayId}.${overlayVisibleClass} {
        opacity: 1;
        pointer-events: auto;
        transform: translateY(0);
      }

      #${overlayId} button {
        width: 26px;
        height: 26px;
        padding: 0;
        border: 1px solid rgba(255, 255, 255, 0.22);
        border-radius: 6px;
        color: #fff;
        background: rgba(255, 255, 255, 0.12);
        font: 700 16px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        cursor: pointer;
      }

      #${overlayId} button:hover,
      #${overlayId} button:focus-visible,
      #${overlayId} button[aria-pressed="true"] {
        background: rgba(255, 255, 255, 0.22);
        outline: none;
      }

      #${overlayId} .yt-hq-speed-readout {
        width: 48px;
        text-align: center;
        font-weight: 700;
        letter-spacing: 0;
      }

      #${overlayId} input[type="range"] {
        width: 110px;
        accent-color: #fff;
        cursor: pointer;
      }
    `;

    (document.head || document.documentElement).appendChild(style);
  }

  function createSpeedOverlay() {
    injectSpeedStyles();

    const overlay = document.createElement("div");
    overlay.id = overlayId;
    overlay.setAttribute("aria-label", "Playback speed");

    const slowerButton = document.createElement("button");
    slowerButton.type = "button";
    slowerButton.textContent = "-";
    slowerButton.title = "Slower";
    slowerButton.setAttribute("aria-label", "Decrease speed by 0.05x");

    speedReadout = document.createElement("span");
    speedReadout.className = "yt-hq-speed-readout";

    const fasterButton = document.createElement("button");
    fasterButton.type = "button";
    fasterButton.textContent = "+";
    fasterButton.title = "Faster";
    fasterButton.setAttribute("aria-label", "Increase speed by 0.05x");

    normalToggleButton = document.createElement("button");
    normalToggleButton.type = "button";
    normalToggleButton.textContent = "1x";

    speedSlider = document.createElement("input");
    speedSlider.type = "range";
    speedSlider.min = String(speedMin);
    speedSlider.max = String(speedMax);
    speedSlider.step = String(speedStep);
    speedSlider.title = "Playback speed";
    speedSlider.setAttribute("aria-label", "Playback speed");

    slowerButton.addEventListener("click", () => stepPreferredSpeed(-1));
    fasterButton.addEventListener("click", () => stepPreferredSpeed(1));
    normalToggleButton.addEventListener("click", toggleNormalSpeed);
    speedSlider.addEventListener("input", () => {
      setPreferredSpeed(speedSlider.value, true);
    });

    overlay.addEventListener("pointerenter", () => {
      overlayPointerInside = true;
      showSpeedOverlay(playerNode, false);
    }, { passive: true });

    overlay.addEventListener("pointerleave", () => {
      overlayPointerInside = false;
      restoreSpeedOverlayFade();
    }, { passive: true });

    overlay.addEventListener("focusin", () => {
      overlayFocusInside = true;
      showSpeedOverlay(playerNode, false);
    });

    overlay.addEventListener("focusout", () => {
      window.setTimeout(() => {
        overlayFocusInside = Boolean(
          speedOverlay && speedOverlay.contains(document.activeElement)
        );
        restoreSpeedOverlayFade();
      }, 0);
    });

    for (const eventName of [
      "click",
      "dblclick",
      "pointerdown",
      "pointerup",
      "mousedown",
      "mouseup",
      "keydown",
      "keyup",
      "wheel"
    ]) {
      overlay.addEventListener(eventName, (event) => {
        event.stopPropagation();
      });
    }

    overlay.append(
      slowerButton,
      speedReadout,
      fasterButton,
      normalToggleButton,
      speedSlider
    );
    updateSpeedOverlay();

    return overlay;
  }

  function bindSpeedOverlayEvents(player) {
    if (!player) {
      return;
    }

    if (playerOverlayEvents) {
      playerOverlayEvents.abort();
    }

    playerPointerInside = false;
    overlayPointerInside = false;
    overlayFocusInside = false;
    playerOverlayEvents = new AbortController();

    player.addEventListener("pointerenter", () => {
      playerPointerInside = true;
      showSpeedOverlay(player, true);
    }, { passive: true, signal: playerOverlayEvents.signal });

    player.addEventListener("pointermove", () => {
      playerPointerInside = true;
      showSpeedOverlay(player, true);
    }, { passive: true, signal: playerOverlayEvents.signal });

    player.addEventListener("pointerleave", () => {
      playerPointerInside = false;
      overlayPointerInside = false;
      overlayFocusInside = false;
      hideSpeedOverlay();
    }, { passive: true, signal: playerOverlayEvents.signal });
  }

  function bindSpeedOverlay(player) {
    if (!player) {
      return;
    }

    if (!speedOverlay || !speedOverlay.isConnected) {
      speedOverlay = createSpeedOverlay();
    }

    if (speedOverlay.parentElement !== player) {
      player.appendChild(speedOverlay);
    }
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
          applyPreferredSpeed();
        }
      }, delay);
    }
  }

  function bindPlayerAndVideo() {
    const player = findPlayer();
    if (player !== playerNode) {
      clearSpeedOverlayFade();

      if (playerNode) {
        hideSpeedOverlay();
      }

      if (playerOverlayEvents) {
        playerOverlayEvents.abort();
        playerOverlayEvents = null;
      }

      playerNode = player;
      bindSpeedOverlay(player);
      bindSpeedOverlayEvents(player);
      scheduleBurst(true);
    }

    bindSpeedOverlay(player);

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
      "emptied",
      "ratechange"
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

    applyPreferredSpeed();
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

  function updatePreferredQuality(value) {
    if (typeof value !== "string" || !value) {
      return;
    }

    if (preferredQuality === value) {
      return;
    }

    preferredQuality = value;
    lastAppliedAt = 0;
    lastAppliedHref = "";
    lastAppliedQuality = "";
    scheduleBurst(true);
  }

  function updatePreferredSpeed(value, previousValue) {
    if (value === null || value === undefined || value === "") {
      return;
    }

    if (previousValue !== null && previousValue !== undefined && previousValue !== "") {
      rememberPlaybackSpeed(previousValue);
    }

    setPreferredSpeed(value, false, false);

    if (!isNormalSpeed(preferredSpeed)) {
      rememberPlaybackSpeed(preferredSpeed);
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

  for (const eventName of ["pointermove", "mousemove", "pointerdown"]) {
    window.addEventListener(eventName, handleGlobalPointerActivity, {
      capture: true,
      passive: true
    });
    document.addEventListener(eventName, handleGlobalPointerActivity, {
      capture: true,
      passive: true
    });
  }

  window.addEventListener(settingsEvent, () => {
    updatePreferredQuality(
      document.documentElement &&
      document.documentElement.getAttribute(settingsAttribute)
    );
  });

  window.addEventListener(speedEvent, () => {
    updatePreferredSpeed(
      document.documentElement &&
      document.documentElement.getAttribute(speedAttribute),
      document.documentElement &&
      document.documentElement.getAttribute(previousSpeedAttribute)
    );
  });

  window.setInterval(() => {
    handlePossibleNavigation();
    bindPlayerAndVideo();
    applyHighestQuality();
    applyPreferredSpeed();
  }, watchdogMs);

  lastHref = location.href;
  updatePreferredQuality(
    document.documentElement &&
    document.documentElement.getAttribute(settingsAttribute)
  );
  updatePreferredSpeed(
    document.documentElement &&
    document.documentElement.getAttribute(speedAttribute),
    document.documentElement &&
    document.documentElement.getAttribute(previousSpeedAttribute)
  );
  startDomWatcher();
  scheduleBurst(true);
})();
