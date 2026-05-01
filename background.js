importScripts("db.js");

(() => {
  "use strict";

  const apiKeyStorageKey = "openaiApiKey";
  const transcriptionModel = "gpt-4o-transcribe";
  const summaryModel = "gpt-5.2";
  const transcriptionUrl = "https://api.openai.com/v1/audio/transcriptions";
  const responsesUrl = "https://api.openai.com/v1/responses";
  const pendingTranscriptions = new Map();

  function nowIso() {
    return new Date().toISOString();
  }

  function getStoredApiKey() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get({ [apiKeyStorageKey]: "" }, (items) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(String(items[apiKeyStorageKey] || "").trim());
      });
    });
  }

  function requireApiKey() {
    return getStoredApiKey().then((apiKey) => {
      if (!apiKey) {
        throw new Error("Add your OpenAI API key in the extension popup first.");
      }

      return apiKey;
    });
  }

  function dataUrlToBlob(base64, mimeType) {
    return fetch(`data:${mimeType};base64,${base64}`).then((response) => response.blob());
  }

  function extractResponseText(response) {
    if (typeof response.output_text === "string") {
      return response.output_text;
    }

    const chunks = [];
    for (const item of response.output || []) {
      for (const content of item.content || []) {
        if (typeof content.text === "string") {
          chunks.push(content.text);
        }
      }
    }

    return chunks.join("\n").trim();
  }

  function parseSummaryJson(text) {
    try {
      return JSON.parse(text);
    } catch (_) {
      const match = /\{[\s\S]*\}/.exec(text);
      if (!match) {
        throw new Error("Summary model did not return JSON.");
      }

      return JSON.parse(match[0]);
    }
  }

  function queuePending(analysisId, promise) {
    const pending = pendingTranscriptions.get(analysisId) || [];
    pending.push(promise);
    pendingTranscriptions.set(analysisId, pending);
    promise.finally(() => {
      const current = pendingTranscriptions.get(analysisId) || [];
      const remaining = current.filter((item) => item !== promise);
      if (remaining.length) {
        pendingTranscriptions.set(analysisId, remaining);
      } else {
        pendingTranscriptions.delete(analysisId);
      }
    });
  }

  async function waitForPendingTranscriptions(analysisId) {
    const pending = pendingTranscriptions.get(analysisId) || [];
    if (!pending.length) {
      return;
    }

    await Promise.allSettled(pending);
  }

  async function createAnalysis(metadata) {
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    const record = {
      id,
      createdAt,
      updatedAt: createdAt,
      status: "recording",
      statusMessage: "Recording audio from the YouTube player.",
      title: metadata.title || "Untitled YouTube video",
      url: metadata.url || "",
      videoId: metadata.videoId || "",
      duration: Number(metadata.duration) || 0,
      startedAt: nowIso(),
      completedAt: "",
      error: "",
      transcriptionModel,
      summaryModel,
      chunks: [],
      transcript: "",
      summary: null
    };

    await YTQ_DB.putAnalysis(record);
    return record;
  }

  async function transcribeChunk(message) {
    const apiKey = await requireApiKey();
    const {
      analysisId,
      audioBase64,
      chunkIndex,
      endTime,
      mimeType,
      startTime
    } = message;
    const safeMimeType = mimeType || "audio/webm";
    const blob = await dataUrlToBlob(audioBase64, safeMimeType);
    const extension = safeMimeType.includes("mp4") ? "mp4" : "webm";
    const form = new FormData();

    form.append("file", blob, `chunk-${String(chunkIndex).padStart(4, "0")}.${extension}`);
    form.append("model", transcriptionModel);
    form.append("language", "en");
    form.append("response_format", "json");
    form.append(
      "prompt",
      "Transcribe this YouTube video audio into clear, accurate English. Preserve technical terms, names, numbers, and punctuation. If the speaker uses another language briefly, translate it into English."
    );

    await YTQ_DB.updateAnalysis(analysisId, (record) => ({
      status: "transcribing",
      statusMessage: `Transcribing audio chunk ${chunkIndex + 1}.`,
      chunks: record.chunks || []
    }));

    const response = await fetch(transcriptionUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      body: form
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Transcription failed (${response.status}): ${detail}`);
    }

    const json = await response.json();
    const text = String(json.text || "").trim();

    await YTQ_DB.updateAnalysis(analysisId, (record) => {
      const chunks = (record.chunks || []).filter((chunk) => chunk.index !== chunkIndex);
      chunks.push({
        index: chunkIndex,
        startTime: Number(startTime) || 0,
        endTime: Number(endTime) || 0,
        text,
        transcribedAt: nowIso()
      });
      chunks.sort((left, right) => left.index - right.index);

      return {
        chunks,
        status: "transcribing",
        statusMessage: `Transcribed ${chunks.length} audio chunk${chunks.length === 1 ? "" : "s"}.`
      };
    });

    return { text };
  }

  async function summarizeAnalysis(analysisId) {
    await waitForPendingTranscriptions(analysisId);

    const record = await YTQ_DB.getAnalysis(analysisId);
    if (!record) {
      throw new Error(`Analysis not found: ${analysisId}`);
    }

    const chunks = [...(record.chunks || [])].sort((left, right) => left.index - right.index);
    const transcript = chunks
      .map((chunk) => `[${formatTimestamp(chunk.startTime)}-${formatTimestamp(chunk.endTime)}]\n${chunk.text}`)
      .join("\n\n")
      .trim();

    if (!transcript) {
      throw new Error("No transcript was captured. Keep the YouTube tab open while recording.");
    }

    await YTQ_DB.updateAnalysis(analysisId, {
      status: "summarizing",
      statusMessage: "Creating summary and section breakdown.",
      transcript
    });

    const apiKey = await requireApiKey();
    const response = await fetch(responsesUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: summaryModel,
        reasoning: { effort: "medium" },
        max_output_tokens: 9000,
        text: {
          format: {
            type: "json_schema",
            name: "youtube_accessibility_summary",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: [
                "title",
                "one_sentence_summary",
                "full_summary",
                "key_takeaways",
                "sections",
                "terms"
              ],
              properties: {
                title: { type: "string" },
                one_sentence_summary: { type: "string" },
                full_summary: { type: "string" },
                key_takeaways: {
                  type: "array",
                  items: { type: "string" }
                },
                sections: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["start", "end", "heading", "summary", "details"],
                    properties: {
                      start: { type: "string" },
                      end: { type: "string" },
                      heading: { type: "string" },
                      summary: { type: "string" },
                      details: {
                        type: "array",
                        items: { type: "string" }
                      }
                    }
                  }
                },
                terms: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["term", "meaning"],
                    properties: {
                      term: { type: "string" },
                      meaning: { type: "string" }
                    }
                  }
                }
              }
            }
          }
        },
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: "You create highly readable English accessibility notes for deaf viewers. Be accurate, complete, plain-spoken, and faithful to the transcript. Do not invent details that are not supported."
              }
            ]
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `Video title: ${record.title}\nVideo URL: ${record.url}\n\nCreate a full-video summary, accessible section breakdowns, key takeaways, and short glossary terms from this transcript. Use the provided timestamps for section boundaries.\n\nTranscript:\n${transcript}`
              }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Summary failed (${response.status}): ${detail}`);
    }

    const json = await response.json();
    const summaryText = extractResponseText(json);
    const summary = parseSummaryJson(summaryText);

    return YTQ_DB.updateAnalysis(analysisId, {
      completedAt: nowIso(),
      status: "complete",
      statusMessage: "Summary ready.",
      transcript,
      summary
    });
  }

  function formatTimestamp(seconds) {
    const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const secs = safeSeconds % 60;

    if (hours) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }

    return `${minutes}:${String(secs).padStart(2, "0")}`;
  }

  async function handleMessage(message) {
    switch (message && message.type) {
      case "analysis:start":
        return { ok: true, analysis: await createAnalysis(message.metadata || {}) };

      case "analysis:transcribeChunk":
        return { ok: true, result: await transcribeChunk(message) };

      case "analysis:finalize":
        return { ok: true, analysis: await summarizeAnalysis(message.analysisId) };

      case "analysis:fail":
        await YTQ_DB.updateAnalysis(message.analysisId, {
          status: "error",
          statusMessage: "Analysis failed.",
          error: message.error || "Unknown analysis error."
        });
        return { ok: true };

      case "analysis:list":
        return { ok: true, analyses: await YTQ_DB.listAnalyses(message.limit || 50) };

      case "analysis:get":
        return { ok: true, analysis: await YTQ_DB.getAnalysis(message.id) };

      case "analysis:delete":
        await YTQ_DB.deleteAnalysis(message.id);
        return { ok: true };

      case "analysis:settings":
        return {
          ok: true,
          hasApiKey: Boolean(await getStoredApiKey()),
          transcriptionModel,
          summaryModel
        };

      default:
        return { ok: false, error: "Unknown message type." };
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender)
      .then(sendResponse)
      .catch(async (error) => {
        if (message && message.analysisId) {
          try {
            await YTQ_DB.updateAnalysis(message.analysisId, {
              status: "error",
              statusMessage: "Analysis failed.",
              error: error.message || String(error)
            });
          } catch (_) {
            // Ignore secondary DB failures while reporting the original error.
          }
        }

        sendResponse({ ok: false, error: error.message || String(error) });
      });

    return true;
  });
})();
