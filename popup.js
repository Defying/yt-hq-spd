(() => {
  "use strict";

  const qualityStorageKey = "preferredQuality";
  const speedStorageKey = "playbackSpeed";
  const previousSpeedStorageKey = "previousPlaybackSpeed";
  const defaultQuality = "highest";
  const defaultSpeed = 1;
  const normalSpeed = 1;
  const speedMin = 0.25;
  const speedMax = 4;
  const speedStep = 0.05;
  const qualitySelect = document.getElementById("quality");
  const speedSlider = document.getElementById("speed");
  const speedValue = document.getElementById("speed-value");
  const slowerButton = document.getElementById("slower");
  const fasterButton = document.getElementById("faster");
  const normalToggleButton = document.getElementById("normal-toggle");
  const status = document.getElementById("status");
  let clearStatusTimer = 0;
  let saveSpeedTimer = 0;
  let currentSpeed = defaultSpeed;
  let previousSpeed = defaultSpeed;

  function normalizeSpeed(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return defaultSpeed;
    }

    const steppedValue = Math.round(numericValue / speedStep) * speedStep;
    return Number(Math.min(speedMax, Math.max(speedMin, steppedValue)).toFixed(2));
  }

  function formatSpeed(value) {
    return `${normalizeSpeed(value).toFixed(2)}x`;
  }

  function isNormalSpeed(value) {
    return Math.abs(normalizeSpeed(value) - normalSpeed) < 0.001;
  }

  function setStatus(message) {
    status.textContent = message;
    window.clearTimeout(clearStatusTimer);
    clearStatusTimer = window.setTimeout(() => {
      status.textContent = "";
    }, 1200);
  }

  function rememberSpeed(value) {
    const speed = normalizeSpeed(value);
    if (!isNormalSpeed(speed)) {
      previousSpeed = speed;
    }
  }

  function updateSpeedControls() {
    speedSlider.value = String(currentSpeed);
    speedValue.textContent = formatSpeed(currentSpeed);

    if (isNormalSpeed(currentSpeed)) {
      if (isNormalSpeed(previousSpeed)) {
        normalToggleButton.textContent = "Use 1.00x";
        normalToggleButton.title = "Use 1.00x";
        normalToggleButton.setAttribute("aria-label", "Temporarily use 1.00x");
      } else {
        normalToggleButton.textContent = `Restore ${formatSpeed(previousSpeed)}`;
        normalToggleButton.title = `Restore ${formatSpeed(previousSpeed)}`;
        normalToggleButton.setAttribute(
          "aria-label",
          `Restore ${formatSpeed(previousSpeed)}`
        );
      }
      return;
    }

    normalToggleButton.textContent = "Use 1.00x";
    normalToggleButton.title = "Use 1.00x";
    normalToggleButton.setAttribute("aria-label", "Temporarily use 1.00x");
  }

  function saveSpeed() {
    window.clearTimeout(saveSpeedTimer);
    saveSpeedTimer = window.setTimeout(() => {
      chrome.storage.sync.set({
        [speedStorageKey]: currentSpeed,
        [previousSpeedStorageKey]: previousSpeed
      }, () => {
        setStatus("Saved");
      });
    }, 120);
  }

  function setSpeed(value, save = false, remember = true) {
    const speed = normalizeSpeed(value);
    if (remember) {
      rememberSpeed(speed);
    }

    currentSpeed = speed;
    updateSpeedControls();

    if (!save) {
      return;
    }

    saveSpeed();
  }

  function toggleNormalSpeed() {
    if (isNormalSpeed(currentSpeed)) {
      if (!isNormalSpeed(previousSpeed)) {
        setSpeed(previousSpeed, true);
      }
      return;
    }

    rememberSpeed(currentSpeed);
    setSpeed(normalSpeed, true, false);
  }

  chrome.storage.sync.get({
    [qualityStorageKey]: defaultQuality,
    [speedStorageKey]: defaultSpeed,
    [previousSpeedStorageKey]: defaultSpeed
  }, (items) => {
    qualitySelect.value = items[qualityStorageKey] || defaultQuality;
    previousSpeed = normalizeSpeed(items[previousSpeedStorageKey]);
    setSpeed(items[speedStorageKey], false);

    if (!isNormalSpeed(currentSpeed)) {
      rememberSpeed(currentSpeed);
      updateSpeedControls();
    }
  });

  qualitySelect.addEventListener("change", () => {
    chrome.storage.sync.set({ [qualityStorageKey]: qualitySelect.value }, () => {
      setStatus("Saved");
    });
  });

  speedSlider.addEventListener("input", () => {
    setSpeed(speedSlider.value, true);
  });

  slowerButton.addEventListener("click", () => {
    setSpeed(normalizeSpeed(speedSlider.value) - speedStep, true);
  });

  fasterButton.addEventListener("click", () => {
    setSpeed(normalizeSpeed(speedSlider.value) + speedStep, true);
  });

  normalToggleButton.addEventListener("click", toggleNormalSpeed);
})();
