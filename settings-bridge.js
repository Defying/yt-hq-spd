(() => {
  "use strict";

  const qualityEventName = "yt-hq-preferred-quality";
  const speedEventName = "yt-hq-playback-speed";
  const saveSpeedEventName = "yt-hq-save-playback-speed";
  const qualityAttributeName = "data-yt-hq-preferred-quality";
  const speedAttributeName = "data-yt-hq-playback-speed";
  const previousSpeedAttributeName = "data-yt-hq-previous-playback-speed";
  const analysisCaptureAttributeName = "data-yt-hq-analysis-capture";
  const qualityStorageKey = "preferredQuality";
  const speedStorageKey = "playbackSpeed";
  const previousSpeedStorageKey = "previousPlaybackSpeed";
  const defaultQuality = "highest";
  const defaultSpeed = 1;
  const speedMin = 0.25;
  const speedMax = 4;
  const speedStep = 0.05;
  const recordingChunkMs = 45000;
  let analysisState = null;

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

  function findVideo() {
    return document.querySelector("video");
  }

  function getVideoId() {
    try {
      return new URL(location.href).searchParams.get("v") || "";
    } catch (_) {
      return "";
    }
  }

  function cleanTitle() {
    return (document.title || "YouTube video").replace(/\s+-\s+YouTube\s*$/i, "");
  }

  function chooseAudioMimeType() {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4"
    ];

    return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || "";
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!response || response.ok === false) {
          reject(new Error((response && response.error) || "Extension background request failed."));
          return;
        }

        resolve(response);
      });
    });
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = String(reader.result || "");
        resolve(result.includes(",") ? result.split(",")[1] : result);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  function waitForSeek(video, time) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }

        settled = true;
        video.removeEventListener("seeked", finish);
        resolve();
      };

      video.addEventListener("seeked", finish, { once: true });
      window.setTimeout(finish, 2500);
      try {
        video.currentTime = time;
      } catch (_) {
        finish();
      }
    });
  }

  async function uploadAudioChunk(state, blob, startTime, endTime) {
    const audioBase64 = await blobToBase64(blob);
    return sendRuntimeMessage({
      type: "analysis:transcribeChunk",
      analysisId: state.analysisId,
      audioBase64,
      chunkIndex: state.chunkIndex++,
      endTime,
      mimeType: state.mimeType || blob.type || "audio/webm",
      startTime
    });
  }

  async function restoreVideoState(state) {
    const { restore, video } = state;
    if (!video || !restore) {
      return;
    }

    try {
      video.playbackRate = restore.playbackRate;
      await waitForSeek(video, restore.currentTime);
      if (restore.paused) {
        video.pause();
      } else {
        await video.play();
      }
    } catch (_) {
      // Restoring playback state is best-effort after a long capture.
    }
  }

  async function finalizeAnalysis(state, error) {
    if (!state || state.finalized) {
      return;
    }

    state.finalized = true;
    document.documentElement.removeAttribute(analysisCaptureAttributeName);
    state.video.removeEventListener("ended", state.handleEnded);
    for (const track of state.stream.getTracks()) {
      track.stop();
    }

    await Promise.allSettled(state.chunkUploads);
    await restoreVideoState(state);

    if (analysisState === state) {
      analysisState = null;
    }

    if (error) {
      await sendRuntimeMessage({
        type: "analysis:fail",
        analysisId: state.analysisId,
        error: error.message || String(error)
      });
      throw error;
    }

    return sendRuntimeMessage({
      type: "analysis:finalize",
      analysisId: state.analysisId
    });
  }

  async function startVideoAnalysis() {
    if (analysisState) {
      return {
        analysisId: analysisState.analysisId,
        status: "recording"
      };
    }

    const settings = await sendRuntimeMessage({ type: "analysis:settings" });
    if (!settings.hasApiKey) {
      throw new Error("Add your OpenAI API key in the extension popup first.");
    }

    const video = findVideo();
    if (!video) {
      throw new Error("No YouTube video element was found on this page.");
    }

    const captureStream = video.captureStream || video.mozCaptureStream;
    if (typeof captureStream !== "function") {
      throw new Error("This browser does not expose video audio capture for the YouTube player.");
    }

    const stream = captureStream.call(video);
    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) {
      throw new Error("No audio track was available to capture from this video.");
    }

    const audioStream = new MediaStream(audioTracks);
    const mimeType = chooseAudioMimeType();
    const recorder = new MediaRecorder(audioStream, mimeType ? { mimeType } : undefined);
    const startResponse = await sendRuntimeMessage({
      type: "analysis:start",
      metadata: {
        duration: Number(video.duration) || 0,
        title: cleanTitle(),
        url: location.href,
        videoId: getVideoId()
      }
    });
    const restore = {
      currentTime: Number(video.currentTime) || 0,
      paused: video.paused,
      playbackRate: video.playbackRate || 1
    };
    const state = {
      analysisId: startResponse.analysis.id,
      chunkIndex: 0,
      chunkStartTime: 0,
      chunkUploads: [],
      finalized: false,
      handleEnded: null,
      mimeType: recorder.mimeType || mimeType || "audio/webm",
      recorder,
      restore,
      stopError: null,
      stream,
      video
    };

    state.handleEnded = () => {
      stopVideoAnalysis().catch(() => {});
    };

    recorder.addEventListener("dataavailable", (event) => {
      if (!event.data || event.data.size === 0 || state.finalized) {
        return;
      }

      const startTime = state.chunkStartTime;
      const endTime = Number(video.currentTime) || startTime;
      state.chunkStartTime = endTime;
      state.chunkUploads.push(uploadAudioChunk(state, event.data, startTime, endTime));
    });

    recorder.addEventListener("stop", () => {
      finalizeAnalysis(state, state.stopError).catch(() => {});
    }, { once: true });

    analysisState = state;
    document.documentElement.setAttribute(analysisCaptureAttributeName, "true");
    video.addEventListener("ended", state.handleEnded);

    try {
      await waitForSeek(video, 0);
      state.chunkStartTime = Number(video.currentTime) || 0;
      video.playbackRate = 1;
      recorder.start(recordingChunkMs);
      await video.play();
    } catch (error) {
      state.stopError = error;
      if (recorder.state !== "inactive") {
        recorder.stop();
      } else {
        await finalizeAnalysis(state, error);
      }
      throw error;
    }

    return {
      analysisId: state.analysisId,
      status: "recording"
    };
  }

  async function stopVideoAnalysis() {
    if (!analysisState) {
      return { status: "idle" };
    }

    const state = analysisState;
    if (state.recorder.state !== "inactive") {
      state.recorder.stop();
    } else {
      await finalizeAnalysis(state);
    }

    return {
      analysisId: state.analysisId,
      status: "finalizing"
    };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.target !== "ytq-content-analysis") {
      return false;
    }

    const task = message.command === "stop"
      ? stopVideoAnalysis()
      : startVideoAnalysis();

    task
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));

    return true;
  });
})();
