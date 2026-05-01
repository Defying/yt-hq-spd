(() => {
  "use strict";

  const listNode = document.getElementById("analysis-list");
  const emptyState = document.getElementById("empty-state");
  const detail = document.getElementById("detail");
  const detailStatus = document.getElementById("detail-status");
  const detailTitle = document.getElementById("detail-title");
  const detailUrl = document.getElementById("detail-url");
  const oneSentence = document.getElementById("one-sentence");
  const fullSummary = document.getElementById("full-summary");
  const takeaways = document.getElementById("takeaways");
  const sections = document.getElementById("sections");
  const terms = document.getElementById("terms");
  const transcript = document.getElementById("transcript");
  const errorBlock = document.getElementById("error-block");
  const errorText = document.getElementById("error");
  const refreshButton = document.getElementById("refresh");
  const deleteButton = document.getElementById("delete-analysis");
  let selectedId = new URL(location.href).searchParams.get("id") || "";
  let refreshTimer = 0;

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

  function formatDate(value) {
    return value
      ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
      : "";
  }

  function clearNode(node) {
    node.textContent = "";
  }

  function appendListItems(node, items) {
    clearNode(node);
    for (const item of items || []) {
      const li = document.createElement("li");
      li.textContent = item;
      node.append(li);
    }
  }

  function renderSections(items) {
    clearNode(sections);
    for (const item of items || []) {
      const card = document.createElement("article");
      card.className = "section-card";

      const time = document.createElement("div");
      time.className = "section-time";
      time.textContent = `${item.start || "?"} - ${item.end || "?"}`;

      const heading = document.createElement("h4");
      heading.textContent = item.heading || "Section";

      const summary = document.createElement("p");
      summary.textContent = item.summary || "";

      const details = document.createElement("ul");
      appendListItems(details, item.details || []);

      card.append(time, heading, summary, details);
      sections.append(card);
    }
  }

  function renderTerms(items) {
    clearNode(terms);
    for (const item of items || []) {
      const term = document.createElement("dt");
      term.textContent = item.term || "";

      const meaning = document.createElement("dd");
      meaning.textContent = item.meaning || "";

      terms.append(term, meaning);
    }
  }

  function renderDetail(record) {
    if (!record) {
      emptyState.hidden = false;
      detail.hidden = true;
      return;
    }

    emptyState.hidden = true;
    detail.hidden = false;
    detailStatus.textContent = record.status || "unknown";
    detailTitle.textContent = record.title || "Untitled video";
    detailUrl.href = record.url || "#";
    detailUrl.textContent = record.url || "";
    transcript.textContent = record.transcript || "Transcript is not ready yet.";

    const summary = record.summary || {};
    oneSentence.textContent = summary.one_sentence_summary || record.statusMessage || "";
    fullSummary.textContent = summary.full_summary || "";
    appendListItems(takeaways, summary.key_takeaways || []);
    renderSections(summary.sections || []);
    renderTerms(summary.terms || []);

    if (record.error) {
      errorBlock.hidden = false;
      errorText.textContent = record.error;
    } else {
      errorBlock.hidden = true;
      errorText.textContent = "";
    }
  }

  async function selectAnalysis(id) {
    selectedId = id;
    history.replaceState(null, "", `analysis.html?id=${encodeURIComponent(id)}`);
    const response = await runtimeMessage({ type: "analysis:get", id });
    renderDetail(response.analysis);
    renderCurrentListState();
  }

  function renderCurrentListState() {
    for (const button of listNode.querySelectorAll(".analysis-card")) {
      button.setAttribute("aria-current", String(button.dataset.id === selectedId));
    }
  }

  async function refresh() {
    const response = await runtimeMessage({ type: "analysis:list", limit: 100 });
    const analyses = response.analyses || [];
    clearNode(listNode);

    if (!analyses.length) {
      listNode.textContent = "No saved analyses yet.";
      renderDetail(null);
      return;
    }

    for (const analysis of analyses) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "analysis-card";
      button.dataset.id = analysis.id;

      const title = document.createElement("span");
      title.className = "analysis-card-title";
      title.textContent = analysis.title || "Untitled video";

      const meta = document.createElement("span");
      meta.className = "analysis-card-meta";
      meta.textContent = `${analysis.status || "unknown"} - ${formatDate(analysis.createdAt)}`;

      button.append(title, meta);
      button.addEventListener("click", () => {
        selectAnalysis(analysis.id).catch(console.error);
      });
      listNode.append(button);
    }

    if (!selectedId || !analyses.some((analysis) => analysis.id === selectedId)) {
      selectedId = analyses[0].id;
    }

    renderCurrentListState();
    await selectAnalysis(selectedId);
  }

  refreshButton.addEventListener("click", () => {
    refresh().catch(console.error);
  });

  deleteButton.addEventListener("click", async () => {
    if (!selectedId || !confirm("Delete this saved transcript summary?")) {
      return;
    }

    await runtimeMessage({ type: "analysis:delete", id: selectedId });
    selectedId = "";
    history.replaceState(null, "", "analysis.html");
    await refresh();
  });

  refresh().catch(console.error);
  refreshTimer = window.setInterval(() => {
    refresh().catch(() => {});
  }, 5000);
  window.addEventListener("pagehide", () => window.clearInterval(refreshTimer));
})();
