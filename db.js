(() => {
  "use strict";

  const dbName = "yt-quality-keeper";
  const dbVersion = 1;
  const analysisStore = "analyses";
  let dbPromise = null;

  function openDatabase() {
    if (dbPromise) {
      return dbPromise;
    }

    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, dbVersion);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(analysisStore)) {
          const store = db.createObjectStore(analysisStore, { keyPath: "id" });
          store.createIndex("createdAt", "createdAt");
          store.createIndex("videoId", "videoId");
          store.createIndex("status", "status");
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return dbPromise;
  }

  async function withStore(mode, callback) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(analysisStore, mode);
      const store = transaction.objectStore(analysisStore);
      let callbackResult;

      transaction.oncomplete = () => resolve(callbackResult);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);

      callbackResult = callback(store);
    });
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function putAnalysis(analysis) {
    const record = {
      ...analysis,
      updatedAt: Date.now()
    };

    await withStore("readwrite", (store) => {
      store.put(record);
    });

    return record;
  }

  async function getAnalysis(id) {
    return withStore("readonly", (store) => requestToPromise(store.get(id)));
  }

  async function updateAnalysis(id, updater) {
    const existing = await getAnalysis(id);
    if (!existing) {
      throw new Error(`Analysis not found: ${id}`);
    }

    const patch = typeof updater === "function" ? updater(existing) : updater;
    return putAnalysis({
      ...existing,
      ...patch
    });
  }

  async function listAnalyses(limit = 50) {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(analysisStore, "readonly");
      const store = transaction.objectStore(analysisStore);
      const index = store.index("createdAt");
      const analyses = [];
      const request = index.openCursor(null, "prev");

      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || analyses.length >= limit) {
          resolve(analyses);
          return;
        }

        analyses.push(cursor.value);
        cursor.continue();
      };

      request.onerror = () => reject(request.error);
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async function deleteAnalysis(id) {
    await withStore("readwrite", (store) => {
      store.delete(id);
    });
  }

  globalThis.YTQ_DB = {
    deleteAnalysis,
    getAnalysis,
    listAnalyses,
    putAnalysis,
    updateAnalysis
  };
})();
