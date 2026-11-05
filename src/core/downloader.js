/**
 * Core Downloader: Batch Queue Runner, Throttling & GM_download Handling
 */

import { sleep } from "./utils.js";

export class BatchDownloader {
  constructor(options = {}) {
    this.delayMs = typeof options === "number" ? options : (options.delayMs || 1800);
    this.isRunning = false;
    this.isCancelled = false;
  }

  cancel() {
    this.isCancelled = true;
    this.isRunning = false;
  }

  downloadBlob(blob, filename) {
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);
  }

  async downloadFile(downloadUrl, targetFilename, subfolder = "invoices") {
    if (!downloadUrl) throw new Error("Keine Download-URL übergeben.");

    const fullPath = subfolder ? `${subfolder}/${targetFilename}` : targetFilename;

    // 1. Primär: GM_download
    if (typeof GM_download === "function") {
      try {
        const ok = await new Promise((resolve) => {
          GM_download({
            url: downloadUrl,
            name: fullPath,
            saveAs: false,
            onload: () => resolve(true),
            onerror: () => resolve(false),
            ontimeout: () => resolve(false)
          });
        });
        if (ok) return true;
      } catch (e) {}
    }

    // 2. Fallback: GM_xmlhttpRequest mit responseType "blob"
    if (typeof GM_xmlhttpRequest === "function") {
      try {
        const blob = await new Promise((resolve, reject) => {
          GM_xmlhttpRequest({
            method: "GET",
            url: downloadUrl,
            responseType: "blob",
            onload: (res) => {
              if (res.response && res.response instanceof Blob) {
                resolve(res.response);
              } else {
                reject(new Error("Kein Blob empfangen"));
              }
            },
            onerror: reject,
            ontimeout: reject
          });
        });
        this.downloadBlob(blob, targetFilename);
        return true;
      } catch (e) {}
    }

    // 3. Fallback: fetch mit Blob
    try {
      const res = await fetch(downloadUrl, { credentials: "include" });
      if (res.ok) {
        const blob = await res.blob();
        this.downloadBlob(blob, targetFilename);
        return true;
      }
    } catch (e) {}

    // 4. Letzter Notnagel: Neuer Tab
    window.open(downloadUrl, "_blank");
    return true;
  }

  run(items, resolveUrlFn, callbacks = {}) {
    return this.runBatch(items, resolveUrlFn, callbacks);
  }

  async runBatch(items, resolveUrlFn, callbacks = {}) {
    const { onStart, onProgress, onItemComplete, onItemError, onComplete } = callbacks;
    this.isRunning = true;
    this.isCancelled = false;

    if (onStart) onStart(items.length);

    for (let i = 0; i < items.length; i++) {
      if (this.isCancelled) break;

      const item = items[i];
      if (onProgress) onProgress(i + 1, items.length, item);

      try {
        const downloadInfo = await resolveUrlFn(item);
        if (downloadInfo && downloadInfo.url) {
          await this.downloadFile(downloadInfo.url, downloadInfo.filename, downloadInfo.subfolder);
          if (onItemComplete) onItemComplete(item, downloadInfo);
        } else {
          if (onItemError) onItemError(item, new Error("Keine Rechnungs-URL auffindbar"));
        }
      } catch (err) {
        if (onItemError) onItemError(item, err);
      }

      if (i < items.length - 1 && !this.isCancelled) {
        await sleep(this.delayMs);
      }
    }

    this.isRunning = false;
    if (onComplete) onComplete(this.isCancelled);
  }
}

