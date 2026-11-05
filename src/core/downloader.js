/**
 * Core Downloader: Batch Queue Runner, Throttling, ZIP Bundling & Multi-stage Download Handling
 */

import { sleep } from "./utils.js";

export class SimpleZip {
  constructor() {
    this.files = [];
  }

  static crc32(buf) {
    let table = SimpleZip.crcTable;
    if (!table) {
      table = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[i] = c >>> 0;
      }
      SimpleZip.crcTable = table;
    }
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
      crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  addFile(filename, uint8Data) {
    this.files.push({ name: filename, data: uint8Data });
  }

  buildBlob() {
    const encoder = new TextEncoder();
    const parts = [];
    const cdParts = [];
    let offset = 0;

    for (const f of this.files) {
      const nameBytes = encoder.encode(f.name);
      const dataBytes = f.data;
      const crc = SimpleZip.crc32(dataBytes);
      const size = dataBytes.length;

      // Local File Header (30 Bytes)
      const lh = new Uint8Array(30);
      const dvLh = new DataView(lh.buffer);
      dvLh.setUint32(0, 0x04034b50, true);
      dvLh.setUint16(4, 10, true);
      dvLh.setUint16(6, 0x0800, true); // UTF-8 Filename Flag
      dvLh.setUint16(8, 0, true);      // Uncompressed (Stored)
      dvLh.setUint16(10, 0, true);
      dvLh.setUint16(12, 0, true);
      dvLh.setUint32(14, crc, true);
      dvLh.setUint32(18, size, true);
      dvLh.setUint32(22, size, true);
      dvLh.setUint16(26, nameBytes.length, true);
      dvLh.setUint16(28, 0, true);

      parts.push(lh, nameBytes, dataBytes);

      // Central Directory Header (46 Bytes)
      const cd = new Uint8Array(46);
      const dvCd = new DataView(cd.buffer);
      dvCd.setUint32(0, 0x02014b50, true);
      dvCd.setUint16(4, 20, true);
      dvCd.setUint16(6, 10, true);
      dvCd.setUint16(8, 0x0800, true);
      dvCd.setUint16(10, 0, true);
      dvCd.setUint16(12, 0, true);
      dvCd.setUint16(14, 0, true);
      dvCd.setUint32(16, crc, true);
      dvCd.setUint32(20, size, true);
      dvCd.setUint32(24, size, true);
      dvCd.setUint16(28, nameBytes.length, true);
      dvCd.setUint16(30, 0, true);
      dvCd.setUint16(32, 0, true);
      dvCd.setUint16(34, 0, true);
      dvCd.setUint16(36, 0, true);
      dvCd.setUint32(38, 0, true);
      dvCd.setUint32(42, offset, true);

      cdParts.push(cd, nameBytes);

      offset += lh.length + nameBytes.length + dataBytes.length;
    }

    const cdOffset = offset;
    let cdSize = 0;
    for (const p of cdParts) cdSize += p.length;

    // End of Central Directory Record (22 Bytes)
    const eocd = new Uint8Array(22);
    const dvEocd = new DataView(eocd.buffer);
    dvEocd.setUint32(0, 0x06054b50, true);
    dvEocd.setUint16(4, 0, true);
    dvEocd.setUint16(6, 0, true);
    dvEocd.setUint16(8, this.files.length, true);
    dvEocd.setUint16(10, this.files.length, true);
    dvEocd.setUint32(12, cdSize, true);
    dvEocd.setUint32(16, cdOffset, true);
    dvEocd.setUint16(20, 0, true);

    return new Blob([...parts, ...cdParts, eocd], { type: "application/zip" });
  }
}

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

  async fetchBinaryData(url) {
    if (url.startsWith("data:")) {
      const base64 = url.split(",")[1];
      const binaryStr = atob(base64);
      const len = binaryStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      return bytes;
    }

    if (typeof GM_xmlhttpRequest === "function") {
      try {
        const ab = await new Promise((resolve, reject) => {
          GM_xmlhttpRequest({
            method: "GET",
            url: url,
            responseType: "arraybuffer",
            onload: (res) => {
              if (res.response) resolve(new Uint8Array(res.response));
              else reject(new Error("Keine Binärdaten empfangen"));
            },
            onerror: reject,
            ontimeout: reject
          });
        });
        return ab;
      } catch (e) {}
    }

    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ab = await res.arrayBuffer();
    return new Uint8Array(ab);
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

  async runBatchZip(items, resolveUrlFn, zipFilename = "rechnungen.zip", callbacks = {}) {
    const { onStart, onProgress, onItemComplete, onItemError, onComplete } = callbacks;
    this.isRunning = true;
    this.isCancelled = false;
    const zip = new SimpleZip();
    let packedCount = 0;

    if (onStart) onStart(items.length);

    for (let i = 0; i < items.length; i++) {
      if (this.isCancelled) break;

      const item = items[i];
      if (onProgress) onProgress(i + 1, items.length, item);

      try {
        const downloadInfo = await resolveUrlFn(item);
        if (downloadInfo && downloadInfo.url) {
          const binaryData = await this.fetchBinaryData(downloadInfo.url);
          zip.addFile(downloadInfo.filename, binaryData);
          packedCount++;
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

    if (packedCount > 0 && !this.isCancelled) {
      const zipBlob = zip.buildBlob();
      this.downloadBlob(zipBlob, zipFilename);
    }

    this.isRunning = false;
    if (onComplete) onComplete(this.isCancelled, packedCount);
  }
}


