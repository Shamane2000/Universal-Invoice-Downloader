// ==UserScript==
// @name         Amazon Pro Invoice Downloader (v1.0 Modular Edition)
// @namespace    https://github.com/Shamane2000/Universal-Invoice-Downloader
// @version      1.0.0
// @description  Automatisierter PDF-Rechnungs-Download für Amazon mit präziser data-csa-c-slot-id Extraktion, vollständiger Paginierung & sauberem Kompakt-Modus
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

  /* ==========================================================================
     CORE UTILITIES
     ========================================================================== */
  const MONTH_MAP_DE = {
    januar: "01", jan: "01", februar: "02", feb: "02",
    märz: "03", mär: "03", mar: "03", april: "04", apr: "04",
    mai: "05", may: "05", juni: "06", jun: "06",
    juli: "07", jul: "07", august: "08", aug: "08",
    september: "09", sep: "09", oktober: "10", okt: "10", oct: "10",
    november: "11", nov: "11", dezember: "12", dez: "12", dec: "12"
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
      const mon = MONTH_MAP_DE[m[2].toLowerCase()] || "01";
      const year = m[3];
      return `${year}${mon}${day}`;
    }
    const isoMatch = cleaned.match(/(\d{4})[-/.](\d{2})[-/.](\d{2})/);
    if (isoMatch) return `${isoMatch[1]}${isoMatch[2]}${isoMatch[3]}`;
    return "20260101";
  }

  function requestHtml(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest === "function") {
        GM_xmlhttpRequest({
          method: "GET",
          url: url,
          headers: {
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
            "Upgrade-Insecure-Requests": "1"
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
        fetch(url, { credentials: "include" })
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

  /* ==========================================================================
     AMAZON ADAPTER (MIT VERIFIZIERTER data-csa-c-slot-id EXTRAKTION)
     ========================================================================== */
  class AmazonAdapter {
    constructor(ui) {
      this.name = "Amazon";
      this.icon = "📦";
      this.ui = ui;
      this.isLoadingPages = false;
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
        /* Buttons in der kompakten Ansicht radikal ausblenden */
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

      // Filter-Auswahl (Jahr) mit URL abgleichen
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
      // 1. Verifizierter Primär-Pfad: data-csa-c-slot-id (z. B. "amzn1.yourorders.order-card.306-2222865-5995503")
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

        // Datum
        const dateMatch = cleanCardText.match(/(\d{1,2}\.\s+[a-zA-ZäöüÄÖÜ]+\s+\d{4})/);
        const rawDate = dateMatch ? dateMatch[1] : "";
        const isoDate = parseGermanDate(rawDate);

        // Titel
        let title = "";
        const productLinks = Array.from(card.querySelectorAll("a[href*='/dp/'], a[href*='asin_title'], a[href*='/gp/product/']"));
        for (const a of productLinks) {
          const txt = cleanString(a.textContent || a.innerText || "");
          if (txt.length > 5 && !/nochmals|locker|verfolgen|rueckgabe|bewert|widerruf|frage/i.test(txt)) {
            title = txt;
            break;
          }
        }

        if (!title) {
          const img = card.querySelector("img[alt]");
          if (img && img.alt && cleanString(img.alt).length > 4) {
            title = cleanString(img.alt);
          }
        }

        if (!title || /frank|hertzschuch|adresse|locker/i.test(title)) {
          title = `Amazon_Bestellung_${orderId.slice(-7)}`;
        }

        const shortName = sanitizeTitle(title);

        // Preis
        let price = "";
        if (isCancelled) {
          price = "Storniert";
        } else {
          const pMatch = cleanCardText.match(/(€\s*[\d.,]+|EUR\s*[\d.,]+|[\d.,]+\s*€)/i);
          if (pMatch) price = pMatch[1].trim();
          if (isRefunded && price) price += " (Erstattet)";
        }
        if (!price) price = isCancelled ? "Storniert" : "-";

        // Popover
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
          price: price,
          popoverUrl: popoverUrl,
          cardElement: isLivePage ? card : null
        });

        // Live-Checkbox
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

    async loadMorePages() {
      const loadBtn = document.getElementById("uid-load-btn");
      if (this.isLoadingPages) {
        this.isLoadingPages = false;
        if (loadBtn) loadBtn.textContent = "⏹ Gestoppt";
        return;
      }

      const pageLinks = Array.from(document.querySelectorAll(".a-pagination li:not(.a-selected) a"))
        .map(a => ({
          num: parseInt((a.textContent || "").trim(), 10),
          href: a.getAttribute("href")
        }))
        .filter(x => !isNaN(x.num) && x.href)
        .sort((a, b) => a.num - b.num);

      if (pageLinks.length === 0) {
        this.ui.setStatus("ℹ️ Keine weiteren Seiten auf dieser Ansicht vorhanden.");
        return;
      }

      this.isLoadingPages = true;
      if (loadBtn) {
        loadBtn.textContent = "⏹ Stop";
        loadBtn.style.background = "#ffebee";
        loadBtn.style.borderColor = "#ef5350";
      }

      for (let i = 0; i < pageLinks.length; i++) {
        if (!this.isLoadingPages) break;

        const p = pageLinks[i];
        const fullUrl = p.href.startsWith("http") ? p.href : window.location.origin + p.href;
        this.ui.setStatus(`⏳ Lade Seite ${p.num} von ${pageLinks[pageLinks.length - 1].num} (${this.ui.ordersMap.size} Bestellungen bisher)...`);

        try {
          const response = await requestHtml(fullUrl);
          const html = response.text || "";
          const doc = new DOMParser().parseFromString(html, "text/html");

          this.collectOrders(doc, false);
          await sleep(1400);
        } catch (err) {
          this.ui.setStatus(`⚠️ Fehler bei Seite ${p.num}: ${err.message}`);
          break;
        }
      }

      this.isLoadingPages = false;
      if (loadBtn) {
        loadBtn.textContent = "🔄 Alle Seiten nachladen";
        loadBtn.style.background = "#f0f2f5";
        loadBtn.style.borderColor = "#d1d5db";
      }
      this.ui.setStatus(`🎉 Fertig! ${this.ui.ordersMap.size} Bestellungen in der Tabelle.`);
    }

    async resolveDownloadInfo(order) {
      if (!order.popoverUrl) return null;
      const fullUrl = order.popoverUrl.startsWith("http") ? order.popoverUrl : window.location.origin + order.popoverUrl;

      const response = await requestHtml(fullUrl);
      if (!response.ok) return null;

      const doc = new DOMParser().parseFromString(response.text, "text/html");
      const pdfLink = doc.querySelector("a[href*='/documents/download/'], a[href*='invoice.pdf']");
      let downloadUrl = "";

      if (pdfLink && pdfLink.getAttribute("href")) {
        const h = pdfLink.getAttribute("href");
        downloadUrl = h.startsWith("http") ? h : window.location.origin + h;
      } else {
        const summaryLink = doc.querySelector("a[href*='summary/print.html']");
        if (summaryLink && summaryLink.getAttribute("href")) {
          const h = summaryLink.getAttribute("href");
          downloadUrl = h.startsWith("http") ? h : window.location.origin + h;
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
     CORE DOWNLOADER
     ========================================================================== */
  class BatchDownloader {
    constructor(delayMs = 1600) {
      this.delayMs = delayMs;
      this.isRunning = false;
      this.isCancelled = false;
    }

    async downloadFile(downloadUrl, targetFilename, subfolder = "invoices") {
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
        const res = await fetch(downloadUrl, { credentials: "include" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
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

    async run(items, resolveUrlFn, callbacks = {}) {
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

  /* ==========================================================================
     CORE UI: UNIVERSAL DASHBOARD
     ========================================================================== */
  class UniversalDashboard {
    constructor(options = {}) {
      this.shopName = options.shopName || "Amazon";
      this.shopIcon = options.shopIcon || "📦";
      this.ordersMap = new Map();
      this.selectedOrders = new Set();
      this.isMinimized = false;
      this.isCompacted = false;
      this.callbacks = options.callbacks || {};

      this.panel = null;
      this.tbody = null;
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
                  <th style="padding:5px; width:75px;">Datum</th>
                  <th style="padding:5px;">Artikel</th>
                  <th style="padding:5px; width:65px; text-align:right;">Betrag</th>
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

      this.bindEvents();
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
      };

      this.panel.querySelector("#uid-copy-debug").onclick = () => {
        const debug = {
          orderCount: this.ordersMap.size,
          selectedCount: this.selectedOrders.size,
          ordersSample: Array.from(this.ordersMap.values()).slice(0, 5)
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
      };

      this.panel.querySelector("#uid-dl-btn").onclick = () => {
        if (this.callbacks.onDownloadBatch) this.callbacks.onDownloadBatch(Array.from(this.selectedOrders));
      };

      this.panel.querySelector("#uid-test-btn").onclick = () => {
        if (this.callbacks.onDownloadTest) this.callbacks.onDownloadTest();
      };
    }

    addOrders(orderList) {
      let addedCount = 0;
      orderList.forEach((order) => {
        if (!this.ordersMap.has(order.id)) {
          this.ordersMap.set(order.id, order);
          addedCount++;
        }
      });
      if (addedCount > 0) {
        this.renderTable();
      }
      return addedCount;
    }

    renderTable() {
      if (!this.tbody) return;
      this.tbody.innerHTML = "";

      const sorted = Array.from(this.ordersMap.values()).sort((a, b) => b.date.localeCompare(a.date));

      sorted.forEach((info) => {
        const tr = document.createElement("tr");
        tr.className = "uid-table-row";
        tr.dataset.oid = info.id;
        tr.style.cssText = "border-bottom: 1px solid #f0f0f0;";

        tr.onclick = (e) => {
          if (e.target.tagName !== "INPUT" && info.cardElement) {
            info.cardElement.scrollIntoView({ behavior: "smooth", block: "center" });
            info.cardElement.style.outline = "2px solid #ff9900";
            setTimeout(() => (info.cardElement.style.outline = "none"), 2000);
          }
        };

        const dDisplay = info.date && info.date.length === 8 ? `${info.date.slice(6, 8)}.${info.date.slice(4, 6)}.${info.date.slice(0, 4)}` : info.date;
        const isCancelled = info.price === "Storniert";
        const priceStyle = isCancelled ? "color:#c62828;font-weight:600;" : "color:#0f1111;font-weight:600;";

        tr.innerHTML = `
          <td style="padding:4px;text-align:center;">
            <input type="checkbox" class="uid-table-cb" data-oid="${info.id}" ${this.selectedOrders.has(info.id) ? "checked" : ""} style="cursor:pointer;">
          </td>
          <td style="padding:4px;white-space:nowrap;color:#64748b;">${dDisplay}</td>
          <td style="padding:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:210px;" title="${info.title}">
            ${info.shortName}
          </td>
          <td style="padding:4px;text-align:right;white-space:nowrap;${priceStyle}">${info.price}</td>
        `;

        tr.querySelector(".uid-table-cb").onchange = (e) => {
          if (e.target.checked) this.selectedOrders.add(info.id);
          else this.selectedOrders.delete(info.id);
          this.updateCounter();
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
          info.title.toLowerCase().includes(q) || 
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
        const firstOrder = Array.from(ui.ordersMap.values())[0];
        ui.setStatus(`🧪 Test-Download für <b>${firstOrder.id}</b>...`);
        const info = await adapter.resolveDownloadInfo(firstOrder);
        if (info && info.url) {
          await downloader.downloadFile(info.url, info.filename, info.subfolder);
          ui.setStatus(`✅ Test-PDF heruntergeladen: <b>${info.filename}</b>`);
        } else {
          ui.setStatus(`⚠️ Rechnungs-URL für ${firstOrder.id} nicht verfügbar.`);
        }
      }
    }
  });

  ui.mount();
  adapter = new AmazonAdapter(ui);
  adapter.init();
})();
