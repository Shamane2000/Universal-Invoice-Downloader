// ==UserScript==
// @name         Amazon Pro Invoice Downloader (v1.1 Modular Edition)
// @namespace    https://github.com/Shamane2000/Universal-Invoice-Downloader
// @version      1.1.0
// @description  Automatisierter PDF-Rechnungs-Download für Amazon mit präziser data-csa-c-slot-id Extraktion, Quickinfo-Hover, Tabellenlink & sauberem Kompakt-Modus
// @match        https://*.amazon.de/*order*
// @match        https://*.amazon.com/*order*
// @grant        GM_download
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @author       Shamane2000
// @license      GPL-3.0
// ==/UserScript==

(function () {
  "use strict";

/**
 * Core Utilities: Sanitization, Parsing, Network Helpers
 */

const MONTH_MAP_DE = {
  januar: "01", jan: "01", februar: "02", feb: "02",
  märz: "03", mär: "03", mar: "03", april: "04", apr: "04",
  mai: "05", may: "05", juni: "06", jun: "06",
  juli: "07", jul: "07", august: "08", aug: "08",
  september: "09", sep: "09", oktober: "10", okt: "10", oct: "10",
  november: "11", nov: "11", dezember: "12", dez: "12", dec: "12"
};

const MONTH_MAP_EN = {
  january: "01", jan: "01", february: "02", feb: "02",
  march: "03", mar: "03", april: "04", apr: "04",
  may: "05", june: "06", jun: "06",
  july: "07", jul: "07", august: "08", aug: "08",
  september: "09", sep: "09", october: "10", oct: "10",
  november: "11", nov: "11", december: "12", dec: "12"
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanString(str) {
  if (!str) return "";
  return str.replace(/[\u200B-\u200D\uFEFF\u200E\u200F]/g, "").replace(/\s+/g, " ").trim();
}

function sanitizeTitle(raw, maxLen = 32) {
  if (!raw) return "artikel";
  let s = cleanString(raw).toLowerCase();
  s = s.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
  s = s.replace(/\b(original|neu|new|pro|plus|stk|stueck|pcs|pack|set)\b/gi, " ");
  s = s.replace(/[^a-z0-9]+/g, "_");
  s = s.replace(/^_+|_+$/g, "");
  return s.slice(0, maxLen).replace(/_+$/, "") || "artikel";
}

function parseGermanDate(text) {
  if (!text) return "20260101";
  const cleaned = cleanString(text);
  const m = cleaned.match(/(\d{1,2})\.\s*([a-zA-ZäöüÄÖÜ]{3,12})\.?\s*(\d{4})/);
  if (m) {
    const day = m[1].padStart(2, "0");
    const mon = MONTH_MAP_DE[m[2].toLowerCase()] || MONTH_MAP_EN[m[2].toLowerCase()] || "01";
    const year = m[3];
    return `${year}${mon}${day}`;
  }
  const mEn = cleaned.match(/([a-zA-Z]{3,12})\s*(\d{1,2}),?\s*(\d{4})/);
  if (mEn) {
    const mon = MONTH_MAP_EN[mEn[1].toLowerCase()] || MONTH_MAP_DE[mEn[1].toLowerCase()] || "01";
    const day = mEn[2].padStart(2, "0");
    const year = mEn[3];
    return `${year}${mon}${day}`;
  }
  const isoMatch = cleaned.match(/(\d{4})[-/.](\d{2})[-/.](\d{2})/);
  if (isoMatch) return `${isoMatch[1]}${isoMatch[2]}${isoMatch[3]}`;
  return "20260101";
}

function parseNumericPrice(str) {
  if (!str || /storniert|cancelled/i.test(str)) return 0;
  const m = str.match(/[\d.,]+/);
  if (!m) return 0;
  const val = m[0];
  if (val.includes(",") && val.includes(".")) {
    return parseFloat(val.replace(/\./g, "").replace(",", ".")) || 0;
  }
  if (val.includes(",")) {
    return parseFloat(val.replace(",", ".")) || 0;
  }
  return parseFloat(val) || 0;
}

function requestHtml(url, options = {}) {
  return new Promise((resolve, reject) => {
    if (typeof GM_xmlhttpRequest === "function") {
      GM_xmlhttpRequest({
        method: options.method || "GET",
        url: url,
        headers: {
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
          "Upgrade-Insecure-Requests": "1",
          ...(options.headers || {})
        },
        onload: (res) => {
          resolve({
            ok: res.status >= 200 && res.status < 300,
            status: res.status,
            finalUrl: res.finalUrl || url,
            text: res.responseText || "",
            via: "GM_xmlhttpRequest"
          });
        },
        onerror: (err) => reject(new Error(err ? (err.error || err.statusText || "GM_xhr Error") : "GM_xhr Error")),
        ontimeout: () => reject(new Error("Timeout (GM_xhr)"))
      });
    } else {
      fetch(url, { credentials: "include", ...(options || {}) })
        .then(async (res) => {
          const txt = await res.text();
          resolve({
            ok: res.ok,
            status: res.status,
            finalUrl: res.url,
            text: txt,
            via: "fetch"
          });
        })
        .catch(reject);
    }
  });
}


/**
 * Core Downloader: Batch Queue Runner, Throttling & GM_download Handling
 */



class BatchDownloader {
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


/**
 * Core UI: Universal Floating Dashboard, Table, Live Search, Hover-Quickinfo & Progress Bar
 */



class UniversalDashboard {
  constructor(options = {}) {
    this.shopName = options.shopName || "Universal";
    this.shopIcon = options.shopIcon || "📦";
    this.ordersMap = new Map();
    this.selectedOrders = new Set();
    this.isMinimized = false;
    this.isCompacted = false;
    this.sortColumn = "date";
    this.sortDirection = "desc";
    this.callbacks = options.callbacks || {};

    this.panel = null;
    this.tbody = null;
    this.tooltipEl = null;
  }

  mount() {
    if (document.getElementById("uid-dashboard-panel")) return;

    this.panel = document.createElement("div");
    this.panel.id = "uid-dashboard-panel";
    this.panel.style.cssText = `
      position: fixed;
      top: 15px;
      right: 15px;
      z-index: 999999;
      background: #ffffff;
      border: 1px solid #d5d9d9;
      border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.18);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      width: 490px;
      padding: 14px;
      color: #0f1111;
      transition: all 0.2s ease-in-out;
      box-sizing: border-box;
    `;

    this.panel.innerHTML = `
      <div id="uid-header" style="display:flex; justify-content:space-between; align-items:center; cursor:move; user-select:none; margin-bottom:12px; padding-bottom:8px; border-bottom:1px solid #e7e7e7;">
        <div style="font-weight:700; font-size:15px; display:flex; align-items:center; gap:8px;">
          <span>${this.shopIcon}</span>
          <span id="uid-title">${this.shopName} Rechnungs-Manager</span>
          <button id="uid-copy-debug" style="font-size:11px; padding:2px 6px; border:1px solid #cbd5e1; border-radius:4px; background:#f8fafc; cursor:pointer;" title="Debug-Daten in Zwischenablage kopieren">📋 Debug</button>
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
          <span id="uid-counter-badge" style="font-size:11px; font-weight:600; background:#e0f2fe; color:#0369a1; padding:3px 8px; border-radius:12px;">
            Ausgewählt: 0 von 0
          </span>
          <button id="uid-min-btn" style="background:none; border:none; font-size:16px; cursor:pointer; padding:0 4px; color:#555;">➖</button>
        </div>
      </div>

      <div id="uid-body">
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; margin-bottom:10px;">
          <button id="uid-load-btn" style="padding:7px 10px; background:#f0f2f5; border:1px solid #d1d5db; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px;">
            🔄 Alle Seiten nachladen
          </button>
          <button id="uid-compact-btn" style="padding:7px 10px; background:#f0f2f5; border:1px solid #d1d5db; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px;">
            👁 Seite kompaktieren
          </button>
        </div>

        <div style="display:flex; gap:8px; margin-bottom:10px;">
          <input type="text" id="uid-search" placeholder="🔍 Suche (Artikel, ID, Betrag)..." style="flex:1; padding:6px 10px; border:1px solid #d1d5db; border-radius:6px; font-size:12px; outline:none;">
          <select id="uid-filter-select" style="padding:6px 10px; border:1px solid #d1d5db; border-radius:6px; font-size:12px; background:#fff; font-weight:600; cursor:pointer;">
            <option value="year-2025" selected>2025</option>
            <option value="year-2026">2026</option>
            <option value="year-2024">2024</option>
            <option value="year-2023">2023</option>
            <option value="months-3">Letzte 3 Monate</option>
            <option value="last30">Letzte 30 Tage</option>
          </select>
        </div>

        <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
          <button id="uid-select-all" style="flex:1; margin-right:4px; padding:5px; background:#fff; border:1px solid #d1d5db; border-radius:4px; font-size:11px; cursor:pointer;">☑️ Alle gefilterten</button>
          <button id="uid-select-none" style="flex:1; margin-left:4px; padding:5px; background:#fff; border:1px solid #d1d5db; border-radius:4px; font-size:11px; cursor:pointer;">◻️ Auswahl leeren</button>
        </div>

        <div style="max-height:260px; overflow-y:auto; border:1px solid #e2e8f0; border-radius:6px; margin-bottom:12px; background:#fafafa;">
          <table style="width:100%; border-collapse:collapse; font-size:11px; text-align:left;">
            <thead style="background:#f1f5f9; position:sticky; top:0; z-index:10; border-bottom:1px solid #cbd5e1;">
              <tr>
                <th style="padding:5px; width:24px; text-align:center;"><input type="checkbox" id="uid-th-cb" style="cursor:pointer;"></th>
                <th class="uid-th-sort" data-sort="date" style="padding:5px; width:75px; cursor:pointer; user-select:none;" title="Klick: Nach Datum sortieren">Datum <span id="uid-sort-date" style="color:#ff9900;">▼</span></th>
                <th class="uid-th-sort" data-sort="title" style="padding:5px; cursor:pointer; user-select:none;" title="Klick: Nach Artikel sortieren">Artikel <span id="uid-sort-title" style="color:#ff9900;"></span></th>
                <th class="uid-th-sort" data-sort="quantity" style="padding:5px; width:45px; text-align:center; cursor:pointer; user-select:none;" title="Klick: Nach Menge sortieren">Stk. <span id="uid-sort-quantity" style="color:#ff9900;"></span></th>
                <th class="uid-th-sort" data-sort="price" style="padding:5px; width:65px; text-align:right; cursor:pointer; user-select:none;" title="Klick: Nach Betrag sortieren">Betrag <span id="uid-sort-price" style="color:#ff9900;"></span></th>
              </tr>
            </thead>
            <tbody id="uid-tbody"></tbody>
          </table>
        </div>

        <div id="uid-progress-wrap" style="display:none; margin-bottom:10px;">
          <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:4px; color:#475569;">
            <span id="uid-progress-label">Download-Fortschritt</span>
            <span id="uid-progress-text">0%</span>
          </div>
          <div style="width:100%; height:6px; background:#e2e8f0; border-radius:3px; overflow:hidden;">
            <div id="uid-progress-fill" style="width:0%; height:100%; background:#ff9900; transition:width 0.2s;"></div>
          </div>
        </div>

        <div style="display:flex; gap:8px;">
          <button id="uid-dl-btn" style="flex:2; padding:9px; background:linear-gradient(to bottom, #f7dfa5, #f0c14b); border:1px solid #a88734; border-radius:6px; font-weight:700; font-size:13px; color:#111; cursor:pointer; box-shadow:0 1px 2px rgba(0,0,0,0.1);">
            📥 Ausgewählte PDFs laden (0)
          </button>
          <button id="uid-test-btn" style="flex:1; padding:9px; background:#f0f2f5; border:1px solid #d1d5db; border-radius:6px; font-weight:600; font-size:12px; color:#111; cursor:pointer;" title="Lädt nur die 1. markierte Bestellung zum Testen">
            🧪 Test (#1)
          </button>
        </div>

        <div id="uid-status" style="margin-top:8px; font-size:11px; color:#555; text-align:center; min-height:16px;"></div>
      </div>
    `;

    document.body.appendChild(this.panel);
    this.tbody = document.getElementById("uid-tbody");

    // Quickinfo Hover Tooltip Element erzeugen
    this.createTooltipElement();

    this.bindEvents();
  }

  createTooltipElement() {
    if (document.getElementById("uid-quickinfo-tooltip")) return;
    this.tooltipEl = document.createElement("div");
    this.tooltipEl.id = "uid-quickinfo-tooltip";
    this.tooltipEl.style.cssText = `
      position: fixed;
      display: none;
      z-index: 1000000;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.2), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
      padding: 10px 12px;
      width: 280px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 11px;
      color: #0f1111;
      pointer-events: none;
      transition: opacity 0.15s ease-in-out;
    `;
    document.body.appendChild(this.tooltipEl);
  }

  bindEvents() {
    const minBtn = this.panel.querySelector("#uid-min-btn");
    const bodyEl = this.panel.querySelector("#uid-body");
    
    minBtn.onclick = (e) => {
      e.stopPropagation();
      this.isMinimized = !this.isMinimized;
      if (this.isMinimized) {
        bodyEl.style.display = "none";
        this.panel.style.width = "auto";
        this.panel.style.padding = "8px 14px";
        minBtn.textContent = "➕";
      } else {
        bodyEl.style.display = "block";
        this.panel.style.width = "490px";
        this.panel.style.padding = "14px";
        minBtn.textContent = "➖";
      }
    };

    this.panel.querySelector("#uid-load-btn").onclick = () => {
      if (this.callbacks.onLoadMore) this.callbacks.onLoadMore();
    };

    const compactBtn = this.panel.querySelector("#uid-compact-btn");
    compactBtn.onclick = () => {
      this.isCompacted = !this.isCompacted;
      document.body.classList.toggle("uid-compact-mode", this.isCompacted);
      compactBtn.textContent = this.isCompacted ? "👁 Normale Ansicht" : "👁 Seite kompaktieren";
      compactBtn.style.background = this.isCompacted ? "#e8f5e9" : "#f0f2f5";
      if (this.callbacks.onToggleCompact) this.callbacks.onToggleCompact(this.isCompacted);
    };

    this.panel.querySelector("#uid-copy-debug").onclick = () => {
      const allOrders = Array.from(this.ordersMap.values());
      const sample = [];
      if (allOrders.length > 0) sample.push(allOrders[0]);
      if (allOrders.length > 1) sample.push(allOrders[1]);
      if (allOrders.length > 12) sample.push(allOrders[12]);
      if (allOrders.length > 25) sample.push(allOrders[25]);
      if (allOrders.length > 3 && !sample.includes(allOrders[allOrders.length - 1])) {
        sample.push(allOrders[allOrders.length - 1]);
      }

      const debug = {
        orderCount: this.ordersMap.size,
        selectedCount: this.selectedOrders.size,
        ordersSample: sample
      };
      const str = JSON.stringify(debug, null, 2);
      if (typeof GM_setClipboard === "function") GM_setClipboard(str);
      else navigator.clipboard.writeText(str);

      const btn = this.panel.querySelector("#uid-copy-debug");
      btn.textContent = "✅ Kopiert!";
      setTimeout(() => (btn.textContent = "📋 Debug"), 2000);
    };

    this.panel.querySelector("#uid-search").oninput = () => this.applyFilter();

    this.panel.querySelector("#uid-th-cb").onchange = (e) => {
      const checked = e.target.checked;
      this.panel.querySelectorAll(".uid-table-row").forEach((tr) => {
        if (tr.style.display !== "none") {
          const oid = tr.dataset.oid;
          if (checked) this.selectedOrders.add(oid);
          else this.selectedOrders.delete(oid);
          const cb = tr.querySelector(".uid-table-cb");
          if (cb) cb.checked = checked;
        }
      });
      this.updateCounter();
      if (this.callbacks.onSelectionChange) this.callbacks.onSelectionChange(this.selectedOrders);
    };

    this.panel.querySelector("#uid-select-all").onclick = () => {
      const thCb = this.panel.querySelector("#uid-th-cb");
      thCb.checked = true;
      thCb.dispatchEvent(new Event("change"));
    };

    this.panel.querySelector("#uid-select-none").onclick = () => {
      this.selectedOrders.clear();
      this.panel.querySelector("#uid-th-cb").checked = false;
      this.panel.querySelectorAll(".uid-table-cb").forEach((cb) => (cb.checked = false));
      this.updateCounter();
      if (this.callbacks.onSelectionChange) this.callbacks.onSelectionChange(this.selectedOrders);
    };

    this.panel.querySelector("#uid-dl-btn").onclick = () => {
      if (this.callbacks.onDownloadBatch) this.callbacks.onDownloadBatch(Array.from(this.selectedOrders));
    };

    this.panel.querySelector("#uid-test-btn").onclick = () => {
      if (this.callbacks.onDownloadTest) this.callbacks.onDownloadTest();
    };

    // Sortierung per Klick auf Tabellen-Spaltentitel
    this.panel.querySelectorAll(".uid-th-sort").forEach(th => {
      th.onclick = () => {
        const col = th.dataset.sort;
        if (this.sortColumn === col) {
          this.sortDirection = this.sortDirection === "asc" ? "desc" : "asc";
        } else {
          this.sortColumn = col;
          this.sortDirection = (col === "title") ? "asc" : "desc";
        }
        this.renderTable();
      };
    });
  }

  addOrders(orderList) {
    let addedCount = 0;
    let updatedCount = 0;

    orderList.forEach((order) => {
      if (!this.ordersMap.has(order.id)) {
        this.ordersMap.set(order.id, order);
        addedCount++;
      } else {
        const existing = this.ordersMap.get(order.id);
        let changed = false;
        if ((!existing.title || existing.title.startsWith("Amazon_Bestellung_")) && order.title && !order.title.startsWith("Amazon_Bestellung_")) {
          existing.title = order.title;
          existing.shortName = order.shortName;
          changed = true;
        }
        if (!existing.imageUrl && order.imageUrl) {
          existing.imageUrl = order.imageUrl;
          changed = true;
        }
        if ((!existing.price || existing.price === "-") && order.price && order.price !== "-") {
          existing.price = order.price;
          changed = true;
        }
        if ((!existing.date || existing.date === "20260101") && order.date && order.date !== "20260101") {
          existing.date = order.date;
          existing.rawDate = order.rawDate;
          changed = true;
        }
        if (changed) updatedCount++;
      }
    });

    if (addedCount > 0 || updatedCount > 0) {
      this.renderTable();
    }
    return addedCount + updatedCount;
  }

  showQuickinfo(e, info) {
    if (!this.tooltipEl) return;
    const thumbHtml = info.imageUrl ? `<img src="${info.imageUrl}" style="width:48px;height:48px;object-fit:contain;border:1px solid #e2e8f0;border-radius:4px;background:#fff;margin-right:10px;flex-shrink:0;">` : "";

    this.tooltipEl.innerHTML = `
      <div style="display:flex;align-items:flex-start;">
        ${thumbHtml}
        <div style="flex:1;overflow:hidden;">
          <div style="font-weight:700;font-size:12px;line-height:1.3;margin-bottom:4px;color:#0f1111;">${info.title || info.shortName}</div>
          <div style="color:#64748b;font-size:10px;margin-bottom:2px;">Bestell-Nr: <b>${info.id}</b> | Menge: <b>${info.quantity || 1} Stück</b></div>
          <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:11px;">
            <span style="color:#475569;">📅 ${info.rawDate || info.date}</span>
            <span style="font-weight:700;color:${info.price === 'Storniert' ? '#c62828' : '#047857'};">${info.price}</span>
          </div>
          <div style="margin-top:6px;font-size:10px;color:#0284c7;">💡 Klick auf Artikelname öffnet Details im neuen Tab</div>
        </div>
      </div>
    `;

    // Positionieren links neben dem Dashboard
    const rect = this.panel.getBoundingClientRect();
    let leftPos = rect.left - 295;
    if (leftPos < 10) leftPos = 10;
    let topPos = e.clientY - 40;
    if (topPos < 10) topPos = 10;
    if (topPos + 180 > window.innerHeight) topPos = window.innerHeight - 190;

    this.tooltipEl.style.left = `${leftPos}px`;
    this.tooltipEl.style.top = `${topPos}px`;
    this.tooltipEl.style.display = "block";
  }

  hideQuickinfo() {
    if (this.tooltipEl) {
      this.tooltipEl.style.display = "none";
    }
  }

  renderTable() {
    if (!this.tbody) return;
    this.tbody.innerHTML = "";

    const sorted = Array.from(this.ordersMap.values()).sort((a, b) => {
      let cmp = 0;
      if (this.sortColumn === "date") {
        cmp = (a.date || "").localeCompare(b.date || "");
      } else if (this.sortColumn === "title") {
        cmp = (a.shortName || a.title || "").localeCompare(b.shortName || b.title || "");
      } else if (this.sortColumn === "quantity") {
        cmp = (a.quantity || 1) - (b.quantity || 1);
      } else if (this.sortColumn === "price") {
        cmp = parseNumericPrice(a.price) - parseNumericPrice(b.price);
      }
      return this.sortDirection === "asc" ? cmp : -cmp;
    });

    // Pfeile im Header aktualisieren
    ["date", "title", "quantity", "price"].forEach(col => {
      const el = this.panel.querySelector(`#uid-sort-${col}`);
      if (el) {
        if (this.sortColumn === col) {
          el.textContent = this.sortDirection === "asc" ? " ▲" : " ▼";
        } else {
          el.textContent = "";
        }
      }
    });

    sorted.forEach((info) => {
      const tr = document.createElement("tr");
      tr.className = "uid-table-row";
      tr.dataset.oid = info.id;
      tr.style.cssText = "border-bottom: 1px solid #f0f0f0; transition: background 0.15s;";

      // Hover Quickinfo
      tr.onmouseenter = (e) => this.showQuickinfo(e, info);
      tr.onmouseleave = () => this.hideQuickinfo();

      // Klickverhalten: Scrollen wenn auf Live-Page (KEIN ungewolltes Öffnen von neuen Tabs beim Zeilenklick!)
      tr.onclick = (e) => {
        if (e.target.tagName === "INPUT" || e.target.tagName === "A" || e.target.closest("a")) return;
        if (info.cardElement && document.body.contains(info.cardElement)) {
          info.cardElement.scrollIntoView({ behavior: "smooth", block: "center" });
          info.cardElement.style.outline = "2px solid #ff9900";
          setTimeout(() => (info.cardElement.style.outline = "none"), 2000);
        }
      };

      const dDisplay = info.date && info.date.length === 8 ? `${info.date.slice(6, 8)}.${info.date.slice(4, 6)}.${info.date.slice(0, 4)}` : (info.rawDate || info.date);
      const isCancelled = info.price === "Storniert";
      const priceStyle = isCancelled ? "color:#c62828;font-weight:600;" : "color:#0f1111;font-weight:600;";

      tr.innerHTML = `
        <td style="padding:4px;text-align:center;">
          <input type="checkbox" class="uid-table-cb" data-oid="${info.id}" ${this.selectedOrders.has(info.id) ? "checked" : ""} style="cursor:pointer;">
        </td>
        <td style="padding:4px;white-space:nowrap;color:#64748b;">${dDisplay}</td>
        <td style="padding:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px;" title="${info.title}">
          <a href="https://www.amazon.de/gp/your-account/order-details?orderID=${info.id}" target="_blank" style="text-decoration:none;color:#0f1111;font-weight:500;" onclick="event.stopPropagation();" title="Klick öffnet Bestelldetails in neuem Tab">
            ${info.shortName}
          </a>
        </td>
        <td style="padding:4px;text-align:center;color:#475569;font-weight:600;">${info.quantity || 1}</td>
        <td style="padding:4px;text-align:right;white-space:nowrap;${priceStyle}">${info.price}</td>
      `;

      tr.querySelector(".uid-table-cb").onchange = (e) => {
        if (e.target.checked) this.selectedOrders.add(info.id);
        else this.selectedOrders.delete(info.id);
        this.updateCounter();
        if (this.callbacks.onSelectionChange) this.callbacks.onSelectionChange(this.selectedOrders);
      };

      this.tbody.appendChild(tr);
    });

    this.applyFilter();
  }

  applyFilter() {
    const q = (document.getElementById("uid-search")?.value || "").toLowerCase().trim();
    let visibleCount = 0;

    this.panel.querySelectorAll(".uid-table-row").forEach((tr) => {
      const oid = tr.dataset.oid;
      const info = this.ordersMap.get(oid);
      if (!info) return;

      const match = !q || 
        info.id.toLowerCase().includes(q) || 
        (info.title && info.title.toLowerCase().includes(q)) || 
        info.shortName.toLowerCase().includes(q) || 
        info.price.toLowerCase().includes(q) || 
        info.date.includes(q);

      tr.style.display = match ? "" : "none";
      if (match) visibleCount++;
    });

    this.updateCounter(visibleCount);
  }

  updateCounter(visibleCount) {
    const currentVisible = visibleCount !== undefined ? visibleCount : this.panel.querySelectorAll(".uid-table-row:not([style*='display: none'])").length;
    const badge = this.panel.querySelector("#uid-counter-badge");
    if (badge) {
      badge.textContent = `Ausgewählt: ${this.selectedOrders.size} von ${currentVisible}`;
    }

    const dlBtn = this.panel.querySelector("#uid-dl-btn");
    if (dlBtn) {
      dlBtn.textContent = `📥 Ausgewählte PDFs laden (${this.selectedOrders.size})`;
      dlBtn.disabled = this.selectedOrders.size === 0;
      dlBtn.style.opacity = this.selectedOrders.size === 0 ? "0.6" : "1";
    }
  }

  setStatus(html) {
    const el = this.panel.querySelector("#uid-status");
    if (el) el.innerHTML = html;
  }

  setProgress(current, total, text = "") {
    const wrap = this.panel.querySelector("#uid-progress-wrap");
    const fill = this.panel.querySelector("#uid-progress-fill");
    const pText = this.panel.querySelector("#uid-progress-text");

    if (total === 0) {
      if (wrap) wrap.style.display = "none";
      return;
    }

    if (wrap) wrap.style.display = "block";
    const pct = Math.round((current / total) * 100);
    if (fill) fill.style.width = `${pct}%`;
    if (pText) pText.textContent = text || `${current} / ${total} (${pct}%)`;
  }
}

/**
 * Amazon Shop Adapter
 * Uses verified data-csa-c-slot-id attribute for 100% order ID precision,
 * thumbnail extraction for Quickinfo-Hover, and robust multi-page pagination.
 */



class AmazonAdapter {
  constructor(ui) {
    this.name = "Amazon";
    this.icon = "📦";
    this.ui = ui;
    this.isLoadingPages = false;
  }

  matches() {
    const h = window.location.hostname;
    const p = window.location.pathname;
    return (h.includes("amazon.de") || h.includes("amazon.com")) && (p.includes("order") || p.includes("your-orders"));
  }

  injectStyles() {
    if (document.getElementById("uid-amazon-styles")) return;
    const style = document.createElement("style");
    style.id = "uid-amazon-styles";
    style.textContent = `
      body.uid-compact-mode .order-card,
      body.uid-compact-mode .js-order-card,
      body.uid-compact-mode .a-box-group {
        margin-bottom: 6px !important;
        border: 1px solid #cbd5e1 !important;
        border-radius: 6px !important;
        box-shadow: none !important;
      }
      body.uid-compact-mode .order-header,
      body.uid-compact-mode .yohtmlc-order-header,
      body.uid-compact-mode .a-box-header {
        padding: 4px 12px !important;
        font-size: 11px !important;
        background: #f8fafc !important;
      }
      body.uid-compact-mode .yohtmlc-recipient {
        display: none !important;
      }
      body.uid-compact-mode .yohtmlc-item {
        padding: 4px 12px !important;
      }
      body.uid-compact-mode .yohtmlc-item img,
      body.uid-compact-mode .order-card img {
        width: 32px !important;
        height: 32px !important;
        object-fit: contain !important;
      }
      body.uid-compact-mode .a-box-group .a-button,
      body.uid-compact-mode .order-card .a-button,
      body.uid-compact-mode .yohtmlc-item .a-button,
      body.uid-compact-mode .order-card .a-fixed-right-grid-col.a-col-right,
      body.uid-compact-mode .yohtmlc-item .a-fixed-right-grid-col.a-col-right,
      body.uid-compact-mode [class*="shipment-status-action"],
      body.uid-compact-mode [class*="buy-again"],
      body.uid-compact-mode [class*="return-window"],
      body.uid-compact-mode [class*="warranty"],
      body.uid-compact-mode [class*="support"] {
        display: none !important;
      }
      body.uid-compact-mode .order-card .a-fixed-right-grid-col.a-col-left,
      body.uid-compact-mode .yohtmlc-item .a-fixed-right-grid-col.a-col-left {
        width: 100% !important;
        padding-right: 0 !important;
        float: none !important;
      }
    `;
    document.head.appendChild(style);
  }

  init() {
    this.injectStyles();
    this.collectOrders(document, true);
    setInterval(() => this.collectOrders(document, true), 2000);

    // Sync Year Dropdown
    const urlParams = new URLSearchParams(window.location.search);
    const currentTimeFilter = urlParams.get("timeFilter") || "";
    const filterSelect = document.getElementById("uid-filter-select");
    if (filterSelect && currentTimeFilter) {
      filterSelect.value = currentTimeFilter;
      filterSelect.onchange = (e) => {
        const val = e.target.value;
        const targetUrl = new URL(window.location.href);
        targetUrl.searchParams.set("timeFilter", val);
        targetUrl.searchParams.delete("page");
        targetUrl.searchParams.delete("startIndex");
        window.location.href = targetUrl.toString();
      };
    }
  }

  extractOrderId(card) {
    // 1. Verifizierter Primär-Pfad: data-csa-c-slot-id (amzn1.yourorders.order-card.306-XXXXXXX-XXXXXXX)
    const slotId = card.getAttribute("data-csa-c-slot-id") || "";
    const slotMatch = slotId.match(/(\d{3}-\d{7}-\d{7})/);
    if (slotMatch) return slotMatch[1];

    // 2. data-order-id
    const dataOid = card.getAttribute("data-order-id") || card.dataset?.orderId || "";
    if (dataOid && /\d{3}-\d{7}-\d{7}/.test(dataOid)) return dataOid;

    // 3. Detail-Links
    const link = card.querySelector("a[href*='orderID='], a[href*='orderId=']");
    if (link) {
      const hrefMatch = (link.getAttribute("href") || "").match(/(\d{3}-\d{7}-\d{7})/);
      if (hrefMatch) return hrefMatch[1];
    }

    // 4. InnerHTML Fallback
    const rawMatch = (card.innerHTML || "").match(/(\d{3}-\d{7}-\d{7})/);
    if (rawMatch) return rawMatch[1];

    return "";
  }

  extractOrdersFromDoc(doc, isLivePage = false) {
    const cards = Array.from(doc.querySelectorAll(".order-card, .js-order-card, div[data-component='orderCard']"));
    const orderList = [];

    cards.forEach((card) => {
      const orderId = this.extractOrderId(card);
      if (!orderId) return;

      const cleanCardText = cleanString(card.textContent || card.innerText || "");
      const isCancelled = /storniert|cancelled/i.test(cleanCardText);
      const isRefunded = /erstattet|refunded/i.test(cleanCardText);

      // Datum ermitteln
      const header = card.querySelector(".order-header, .yohtmlc-order-header, .a-box-header") || card;
      const headerText = cleanString(header.textContent || "");
      let dateMatch = headerText.match(/(\d{1,2}\.\s*[a-zA-ZäöüÄÖÜ]{3,12}\.?\s*\d{4})/);
      if (!dateMatch) {
        dateMatch = cleanCardText.match(/(\d{1,2}\.\s*[a-zA-ZäöüÄÖÜ]{3,12}\.?\s*\d{4})/);
      }
      if (!dateMatch && card.parentElement) {
        dateMatch = cleanString(card.parentElement.textContent || "").match(/(\d{1,2}\.\s*[a-zA-ZäöüÄÖÜ]{3,12}\.?\s*\d{4})/);
      }
      const rawDate = dateMatch ? dateMatch[1] : "";
      const isoDate = parseGermanDate(rawDate);

      // Bild / Thumbnail für Quickinfo-Hover
      let imageUrl = "";
      const img = card.querySelector("img[src*='images-amazon'], img[src*='media-amazon'], img[src*='ssl-images-amazon'], img[data-a-hires], img");
      if (img) {
        imageUrl = img.getAttribute("src") || img.getAttribute("data-a-hires") || img.getAttribute("data-src") || "";
      }

      // Titel ermitteln
      let title = "";
      if (img && img.alt && cleanString(img.alt).length > 4) {
        const altTxt = cleanString(img.alt);
        if (!/produkt|artikel|bild|image|amazon/i.test(altTxt)) {
          title = altTxt;
        }
      }

      if (!title) {
        const productLinks = Array.from(card.querySelectorAll(".yohtmlc-item a, a[href*='/dp/'], a[href*='/gp/product/'], a[href*='asin'], a.a-link-normal"));
        for (const a of productLinks) {
          const txt = cleanString(a.textContent || a.innerText || "");
          if (txt.length > 5 && !/nochmals|locker|verfolgen|rueckgabe|bewert|widerruf|frage|bestelldetails|rechnung|problem|support|hilfe|kontakt/i.test(txt)) {
            title = txt;
            break;
          }
        }
      }

      if (!title || /frank|hertzschuch|adresse|locker/i.test(title)) {
        title = `Amazon_Bestellung_${orderId.slice(-7)}`;
      }

      const shortName = sanitizeTitle(title);

      // Menge (Anzahl der Artikel in der Bestellung)
      const itemBlocks = card.querySelectorAll(".yohtmlc-item, [class*='yohtmlc-item'], .shipment");
      let totalQty = 0;
      if (itemBlocks.length > 0) {
        itemBlocks.forEach(ib => {
          const qm = (ib.textContent || "").match(/(?:menge|qty|stk|stück)[:\s]+(\d+)/i);
          if (qm) {
            totalQty += parseInt(qm[1], 10);
          } else {
            totalQty += 1;
          }
        });
      }
      if (totalQty === 0) {
        const qm = cleanCardText.match(/(?:menge|qty|stk|stück)[:\s]+(\d+)/i);
        totalQty = qm ? parseInt(qm[1], 10) : 1;
      }

      // Preis ermitteln
      let price = "";
      if (isCancelled) {
        price = "Storniert";
      } else {
        const hpMatch = headerText.match(/(€\s*[\d.,]+|EUR\s*[\d.,]+|[\d.,]+\s*€)/i);
        if (hpMatch) {
          price = hpMatch[1].trim();
        } else {
          const pMatch = cleanCardText.match(/(€\s*[\d.,]+|EUR\s*[\d.,]+|[\d.,]+\s*€)/i);
          if (pMatch) price = pMatch[1].trim();
        }
        if (isRefunded && price) price += " (Erstattet)";
      }
      if (!price) price = isCancelled ? "Storniert" : "-";

      // Popover-Rechnungs-URL
      let popoverUrl = "";
      if (!isCancelled) {
        const invoiceLink = Array.from(card.querySelectorAll("a, span[data-action]")).find(el => 
          /rechnung/i.test(el.textContent || "") || (el.getAttribute("href") || "").includes("invoice")
        );

        if (invoiceLink) {
          const href = invoiceLink.getAttribute("href");
          if (href && href !== "javascript:void(0)") {
            popoverUrl = href;
          } else {
            const popoverData = invoiceLink.getAttribute("data-a-popover") || "";
            const urlMatch = popoverData.match(/["']url["']\s*:\s*["']([^"']+)["']/);
            if (urlMatch) popoverUrl = urlMatch[1];
          }
        }

        if (!popoverUrl) {
          popoverUrl = `/your-orders/invoice/popover?orderId=${orderId}`;
        }
      }

      orderList.push({
        id: orderId,
        date: isoDate,
        rawDate: rawDate,
        title: title,
        shortName: shortName,
        quantity: totalQty,
        price: price,
        imageUrl: imageUrl,
        popoverUrl: popoverUrl,
        cardElement: isLivePage ? card : null
      });

      // Checkbox auf Live-Seite einhängen
      if (isLivePage && !card.querySelector(".uid-card-cb")) {
        const header = card.querySelector(".order-header, .yohtmlc-order-header, .a-box-header") || card.firstElementChild;
        if (header) {
          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.className = "uid-card-cb";
          cb.dataset.oid = orderId;
          cb.style.cssText = "margin-right: 8px; transform: scale(1.15); cursor: pointer; vertical-align: middle;";
          cb.checked = this.ui.selectedOrders.has(orderId);
          cb.onchange = (e) => {
            if (e.target.checked) this.ui.selectedOrders.add(orderId);
            else this.ui.selectedOrders.delete(orderId);
            this.ui.updateCounter();
          };
          header.prepend(cb);
        }
      }
    });

    return orderList;
  }

  collectOrders(doc, isLivePage = false) {
    const list = this.extractOrdersFromDoc(doc, isLivePage);
    this.ui.addOrders(list);
  }

  getStartIndexFromUrl(urlString) {
    try {
      const u = new URL(urlString, window.location.origin);
      const s = u.searchParams.get("startIndex");
      if (s !== null && !isNaN(parseInt(s, 10))) return parseInt(s, 10);
      const p = u.searchParams.get("page");
      if (p !== null && !isNaN(parseInt(p, 10))) return (parseInt(p, 10) - 1) * 10;
    } catch (e) {}
    return -1;
  }

  getTotalOrdersFromPage() {
    const text = cleanString(document.body.textContent || "");
    const m = text.match(/(\d+)\s+(?:bestellungen|orders)\b/i);
    if (m) return parseInt(m[1], 10);
    return null;
  }

  async loadMorePages() {
    const loadBtn = document.getElementById("uid-load-btn");
    if (this.isLoadingPages) {
      this.isLoadingPages = false;
      if (loadBtn) loadBtn.textContent = "⏹ Gestoppt";
      return;
    }

    const totalOrders = this.getTotalOrdersFromPage();
    const liveStartIndex = Math.max(0, this.getStartIndexFromUrl(window.location.href));
    const visitedStartIndexes = new Set([liveStartIndex]);
    const queue = [];

    const baseUrl = new URL(window.location.href);
    baseUrl.searchParams.set("disableCsd", "no-js");

    // Wenn Amazon "85 Bestellungen" meldet, können wir alle Seiten deterministisch berechnen!
    if (totalOrders && totalOrders > 10) {
      const maxIndex = (Math.ceil(totalOrders / 10) - 1) * 10;
      for (let sIndex = 0; sIndex <= maxIndex; sIndex += 10) {
        if (!visitedStartIndexes.has(sIndex)) {
          visitedStartIndexes.add(sIndex);
          const u = new URL(baseUrl.toString());
          u.searchParams.set("startIndex", sIndex.toString());
          queue.push({
            num: Math.floor(sIndex / 10) + 1,
            sIndex: sIndex,
            url: u.toString()
          });
        }
      }
    } else {
      // Fallback: Dynamische Extraktion aus Paginierungslinks
      const addUrlToQueue = (href, pageNum) => {
        if (!href || href === "#" || href.startsWith("javascript:")) return;
        const sIndex = this.getStartIndexFromUrl(href);
        if (sIndex < 0 || visitedStartIndexes.has(sIndex)) return;

        visitedStartIndexes.add(sIndex);

        let full = href.startsWith("http") ? href : window.location.origin + href;
        try {
          const u = new URL(full);
          u.searchParams.set("disableCsd", "no-js");
          full = u.toString();
        } catch (e) {
          full += (full.includes("?") ? "&" : "?") + "disableCsd=no-js";
        }

        queue.push({ num: pageNum || Math.floor(sIndex / 10) + 1, sIndex: sIndex, url: full });
      };

      Array.from(document.querySelectorAll(".a-pagination li:not(.a-selected):not(.a-disabled) a")).forEach(a => {
        const num = parseInt((a.textContent || "").trim(), 10);
        addUrlToQueue(a.getAttribute("href"), isNaN(num) ? null : num);
      });
    }

    queue.sort((a, b) => a.sIndex - b.sIndex);

    if (queue.length === 0) {
      this.ui.setStatus("ℹ️ Keine weiteren Seiten auf dieser Ansicht vorhanden.");
      return;
    }

    this.isLoadingPages = true;
    if (loadBtn) {
      loadBtn.textContent = "⏹ Stop";
      loadBtn.style.background = "#ffebee";
      loadBtn.style.borderColor = "#ef5350";
    }

    let currentIndex = 0;
    const totalToLoad = queue.length;

    while (currentIndex < queue.length && this.isLoadingPages) {
      const p = queue[currentIndex];
      currentIndex++;

      const pct = Math.round((currentIndex / totalToLoad) * 100);
      this.ui.setProgress(pct);
      this.ui.setStatus(`⏳ Lade Seite ${p.num} von ${Math.ceil((totalOrders || queue.length * 10) / 10)} (${this.ui.ordersMap.size} Bestellungen erfasst)...`);

      try {
        const response = await requestHtml(p.url);
        const html = response.text || "";
        const doc = new DOMParser().parseFromString(html, "text/html");

        this.collectOrders(doc, false);

        await sleep(1200);
      } catch (err) {
        this.ui.setStatus(`⚠️ Fehler bei Seite ${p.num}: ${err.message}`);
        break;
      }
    }

    this.isLoadingPages = false;
    this.ui.setProgress(100);
    setTimeout(() => this.ui.setProgress(-1), 3000);

    if (loadBtn) {
      loadBtn.textContent = "🔄 Alle Seiten nachladen";
      loadBtn.style.background = "#f0f2f5";
      loadBtn.style.borderColor = "#d1d5db";
    }
    this.ui.setStatus(`🎉 Fertig! Alle ${this.ui.ordersMap.size} Bestellungen erfasst & geladen.`);
  }

  async resolveDownloadInfo(order) {
    if (!order.popoverUrl) {
      order.popoverUrl = `/your-orders/invoice/popover?orderId=${order.id}`;
    }
    let fullUrl = order.popoverUrl.startsWith("http") ? order.popoverUrl : window.location.origin + order.popoverUrl;
    try {
      const u = new URL(fullUrl);
      u.searchParams.set("disableCsd", "no-js");
      fullUrl = u.toString();
    } catch (e) {}

    const response = await requestHtml(fullUrl);
    if (!response.ok) {
      // Fallback direkt zur Amazon-Bestellübersicht
      const summaryUrl = `https://www.amazon.de/gp/css/summary/print.html?orderID=${order.id}`;
      return {
        url: summaryUrl,
        filename: `${order.date}-${order.id}-${order.shortName}.html`,
        subfolder: "invoices/amazon"
      };
    }

    const doc = new DOMParser().parseFromString(response.text, "text/html");
    const allLinks = Array.from(doc.querySelectorAll("a[href]"));

    let downloadUrl = "";

    // 1. Primär: Echter PDF-Rechnungsdownload
    const pdfLink = allLinks.find(a => {
      const h = (a.getAttribute("href") || "").toLowerCase();
      const t = (a.textContent || "").toLowerCase();
      return h.includes("/documents/download/") || h.includes("invoice.pdf") || (h.includes("invoice") && !h.includes("popover")) || t.includes("rechnung") || t.includes("invoice");
    });

    if (pdfLink) {
      const h = pdfLink.getAttribute("href");
      downloadUrl = h.startsWith("http") ? h : window.location.origin + h;
    } else {
      // 2. Sekundär: Offizielle Amazon-Druckübersicht (Bestellübersicht)
      const summaryLink = allLinks.find(a => (a.getAttribute("href") || "").includes("print.html"));
      if (summaryLink) {
        const h = summaryLink.getAttribute("href");
        downloadUrl = h.startsWith("http") ? h : window.location.origin + h;
      } else {
        // 3. Fallback: Direkte Druckübersichts-URL von Amazon
        downloadUrl = `https://www.amazon.de/gp/css/summary/print.html?orderID=${order.id}`;
      }
    }

    if (!downloadUrl) return null;

    const ext = downloadUrl.includes("print.html") ? "html" : "pdf";
    const filename = `${order.date}-${order.id}-${order.shortName}.${ext}`;

    return {
      url: downloadUrl,
      filename: filename,
      subfolder: "invoices/amazon"
    };
  }
}


  /* ==========================================================================
     APP INITIALISIERUNG
     ========================================================================== */
  const downloader = new BatchDownloader(1800);
  let adapter = null;

  const ui = new UniversalDashboard({
    shopName: "Amazon",
    shopIcon: "📦",
    callbacks: {
      onLoadMore: () => {
        if (adapter) adapter.loadMorePages();
      },
      onDownloadBatch: async (selectedIds) => {
        if (selectedIds.length === 0 || !adapter) return;
        const items = selectedIds.map(id => ui.ordersMap.get(id)).filter(Boolean);

        const dlBtn = document.getElementById("uid-dl-btn");
        if (dlBtn) dlBtn.disabled = true;

        await downloader.run(
          items,
          (order) => adapter.resolveDownloadInfo(order),
          {
            onStart: (total) => {
              ui.setProgress(0, total, `0 / ${total} (0%)`);
            },
            onProgress: (cur, total, item) => {
              ui.setProgress(cur, total);
              ui.setStatus(`[${cur}/${total}] Lade PDF: ${item.shortName} ...`);
            },
            onComplete: () => {
              ui.setStatus(`✅ Fertig! Gespeichert in: Downloads/invoices/amazon/`);
              if (dlBtn) dlBtn.disabled = false;
            }
          }
        );
      },
      onDownloadTest: async () => {
        if (ui.ordersMap.size === 0 || !adapter) return;
        const testOrder = Array.from(ui.selectedOrders.values()).map(id => ui.ordersMap.get(id)).find(o => o && o.price !== "Storniert") ||
                          Array.from(ui.ordersMap.values()).find(o => o && o.price !== "Storniert") ||
                          Array.from(ui.ordersMap.values())[0];
        ui.setStatus(`🧪 Test-Download für <b>${testOrder.id}</b> (${testOrder.shortName})...`);
        const info = await adapter.resolveDownloadInfo(testOrder);
        if (info && info.url) {
          await downloader.downloadFile(info.url, info.filename, info.subfolder);
          ui.setStatus(`✅ Test-PDF heruntergeladen: <b>${info.filename}</b>`);
        } else {
          ui.setStatus(`⚠️ Rechnungs-URL für ${testOrder.id} nicht verfügbar.`);
        }
      }
    }
  });

  ui.mount();
  adapter = new AmazonAdapter(ui);
  adapter.init();
})();
