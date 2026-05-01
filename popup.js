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
  const apiKeyInput = document.getElementById("api-key");
  const saveApiKeyButton = document.getElementById("save-api-key");
  const clearApiKeyButton = document.getElementById("clear-api-key");
  const analyzeVideoButton = document.getElementById("analyze-video");
  const stopAnalysisButton = document.getElementById("stop-analysis");
  const openLibraryButton = document.getElementById("open-library");
  const refreshHistoryButton = document.getElementById("refresh-history");
  const history = document.getElementById("history");
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

  function setBusy(busy) {
    analyzeVideoButton.disabled = busy;
    stopAnalysisButton.disabled = busy;
  }

  function runtimeMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!response || response.ok === false) {
          reject(new Error((response && response.error) || "Request failed."));
          return;
        }

        resolve(response);
      });
    });
  }

  function localStorageGet(defaults) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(defaults, (items) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(items);
      });
    });
  }

  function localStorageSet(items) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(items, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve();
      });
    });
  }

  function localStorageRemove(key) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove(key, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve();
      });
    });
  }

  function sendToActiveYouTubeTab(command) {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs && tabs[0];
        if (!tab || !tab.id) {
          reject(new Error("No active tab found."));
          return;
        }

        chrome.tabs.sendMessage(tab.id, {
          target: "ytq-content-analysis",
          command
        }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }

          if (!response || response.ok === false) {
            reject(new Error((response && response.error) || "Could not reach the YouTube tab."));
            return;
          }

          resolve(response);
        });
      });
    });
  }

  function formatDate(value) {
    if (!value) {
      return "";
    }

    return new Date(value).toLocaleString([], {
      dateStyle: "medium",
      timeStyle: "short"
    });
  }

  function openAnalysis(id = "") {
    const url = chrome.runtime.getURL(`analysis.html${id ? `?id=${encodeURIComponent(id)}` : ""}`);
    chrome.tabs.create({ url });
  }

  async function refreshHistory() {
    const response = await runtimeMessage({ type: "analysis:list", limit: 5 });
    const analyses = response.analyses || [];
    history.textContent = "";

    if (!analyses.length) {
      history.textContent = "No summaries yet.";
      return;
    }

    for (const analysis of analyses) {
      const item = document.createElement("div");
      item.className = "history-item";

      const title = document.createElement("div");
      title.className = "history-title";
      title.textContent = analysis.title || "Untitled video";

      const meta = document.createElement("div");
      meta.className = "history-meta";
      meta.textContent = `${analysis.status || "unknown"} - ${formatDate(analysis.createdAt)}`;

      const actions = document.createElement("div");
      actions.className = "history-actions";

      const openButton = document.createElement("button");
      openButton.type = "button";
      openButton.textContent = "Open";
      openButton.addEventListener("click", () => openAnalysis(analysis.id));

      actions.append(openButton);
      item.append(title, meta, actions);
      history.append(item);
    }
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

  localStorageGet({ openaiApiKey: "" }).then((items) => {
    apiKeyInput.value = items.openaiApiKey ? "••••••••••••••••" : "";
    apiKeyInput.dataset.hasSavedKey = items.openaiApiKey ? "true" : "false";
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") {
      return;
    }

    if (changes[qualityStorageKey]) {
      qualitySelect.value = changes[qualityStorageKey].newValue || defaultQuality;
    }

    if (changes[previousSpeedStorageKey]) {
      previousSpeed = normalizeSpeed(changes[previousSpeedStorageKey].newValue);
    }

    if (changes[speedStorageKey]) {
      setSpeed(changes[speedStorageKey].newValue, false, false);

      if (!isNormalSpeed(currentSpeed) && !changes[previousSpeedStorageKey]) {
        rememberSpeed(currentSpeed);
        updateSpeedControls();
      }
    } else if (changes[previousSpeedStorageKey]) {
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

  saveApiKeyButton.addEventListener("click", async () => {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey || apiKey.includes("•")) {
      setStatus("Enter a key first");
      return;
    }

    await localStorageSet({ openaiApiKey: apiKey });
    apiKeyInput.value = "••••••••••••••••";
    apiKeyInput.dataset.hasSavedKey = "true";
    setStatus("API key saved locally");
  });

  clearApiKeyButton.addEventListener("click", async () => {
    await localStorageRemove("openaiApiKey");
    apiKeyInput.value = "";
    apiKeyInput.dataset.hasSavedKey = "false";
    setStatus("API key cleared");
  });

  apiKeyInput.addEventListener("focus", () => {
    if (apiKeyInput.dataset.hasSavedKey === "true" && apiKeyInput.value.includes("•")) {
      apiKeyInput.value = "";
    }
  });

  analyzeVideoButton.addEventListener("click", async () => {
    try {
      setBusy(true);
      setStatus("Starting capture...");
      const response = await sendToActiveYouTubeTab("start");
      setStatus("Recording from start at 1x");
      await refreshHistory();
      if (response.analysisId) {
        openAnalysis(response.analysisId);
      }
    } catch (error) {
      setStatus(error.message || String(error));
    } finally {
      setBusy(false);
    }
  });

  stopAnalysisButton.addEventListener("click", async () => {
    try {
      setBusy(true);
      setStatus("Stopping...");
      await sendToActiveYouTubeTab("stop");
      setStatus("Summarizing");
      await refreshHistory();
    } catch (error) {
      setStatus(error.message || String(error));
    } finally {
      setBusy(false);
    }
  });

  openLibraryButton.addEventListener("click", () => openAnalysis());
  refreshHistoryButton.addEventListener("click", () => {
    refreshHistory().catch((error) => setStatus(error.message || String(error)));
  });

  refreshHistory().catch(() => {});
})();
