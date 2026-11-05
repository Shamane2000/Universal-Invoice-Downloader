/**
 * Core Downloader: Batch Queue Runner, Throttling & GM_download Handling
 */

import { sleep } from "./utils.js";

export class BatchDownloader {
  constructor(options = {}) {
    this.delayMs = options.delayMs || 1600;
    this.isRunning = false;
    this.isCancelled = false;
  }

  cancel() {
    this.isCancelled = true;
    this.isRunning = false;
  }

  async downloadFile(downloadUrl, targetFilename, subfolder = "invoices") {
    if (!downloadUrl) throw new Error("Keine Download-URL übergeben.");

    const fullPath = subfolder ? `${subfolder}/${targetFilename}` : targetFilename;

    if (typeof GM_download === "function") {
      return new Promise((resolve, reject) => {
        GM_download({
          url: downloadUrl,
          name: fullPath,
          saveAs: false,
          onload: () => resolve(true),
          onerror: (err) => reject(new Error(err ? (err.error || "Download Error") : "GM_download fehlgeschlagen")),
          ontimeout: () => reject(new Error("Timeout beim Download"))
        });
      });
    } else {
      // Fallback via Blob & dynamischem <a> Tag
      const res = await fetch(downloadUrl, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status} beim Download`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = targetFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
      return true;
    }
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

