// ==UserScript==
// @name         AliExpress Pro Invoice & Receipt Manager
// @name:de      AliExpress Pro Rechnungs-Manager
// @namespace    https://www.aliexpress.com
// @version      5.0
// @description  Automated bulk invoice & receipt downloader with progress bar, live filters, compact view, and multi-language support (EN/DE).
// @description:de Automatisierter Beleg- & Rechnungs-Download mit Fortschrittsbalken, Live-Filtern, kompakter Ansicht & mehrsprachiger Oberfläche (DE/EN).
// @match        https://*.aliexpress.com/p/order/index.html*
// @match        https://*.aliexpress.com/p/order/detail.html*
// @match        https://*.aliexpress.us/p/order/index.html*
// @match        https://*.aliexpress.us/p/order/detail.html*
// @match        https://*.aliexpress.ru/p/order/index.html*
// @match        https://*.aliexpress.ru/p/order/detail.html*
// @grant        GM_download
// @author       Peter Tanner, Shamane2000, Antigravity
// @license      GPL-3.0
// ==/UserScript==

(function () {
  "use strict";

  const AUTO_FLAG = "ali-inv-dl";
  const RECEIPT_TEXTS = /^(receipt|beleg|rechnung|recibo|reçu|fatura|factura|invoice|download receipt)$/i;

  const MONTH_MAP = {
    jan: "01", feb: "02", mar: "03", mär: "03", apr: "04", abr: "04",
    may: "05", mai: "05", jun: "06", jul: "07", aug: "08", ago: "08",
    sep: "09", oct: "10", okt: "10", nov: "11", dec: "12", dez: "12", dic: "12"
  };

  const I18N = {
    en: {
      langBtn: "🌐 EN",
      title: "Invoice Manager",
      loadMore: "🔄 Load more orders",
      stop: "⏹ Stop",
      compactView: "👁 Compact view",
      normalView: "👁 Normal view",
      searchPlaceholder: "🔍 Search (Item, ID, Price)...",
      allYears: "All Years",
      selectAll: "☑ Select filtered",
      clearSelection: "☐ Clear selection",
      colDate: "Date",
      colItem: "Item",
      colPrice: "Total",
      downloadBtn: (count) => `📥 Download selected (${count})`,
      targetDir: (folder) => `📂 Destination: Downloads/aliexpress/${folder}/`,
      allLoaded: "All orders loaded!",
      noWorkerPopup: "Please allow pop-ups for AliExpress in your browser!",
      loadingItem: (idx, total, name) => `[${idx}/${total}] Loading: ${name} ...`,
      finished: (folder) => `✅ Done! Saved to: Downloads/aliexpress/${folder}/`,
      selectedBadge: (sel, vis) => `Selected: ${sel} of ${vis}`
    },
    de: {
      langBtn: "🌐 DE",
      title: "Rechnungs-Manager",
      loadMore: "🔄 Alle nachladen",
      stop: "⏹ Stop",
      compactView: "👁 Seite kompaktieren",
      normalView: "👁 Normale Ansicht",
      searchPlaceholder: "🔍 Suche (Artikel, ID, Betrag)...",
      allYears: "Alle Jahre",
      selectAll: "☑ Alle gefilterten",
      clearSelection: "☐ Auswahl leeren",
      colDate: "Datum",
      colItem: "Artikel",
      colPrice: "Betrag",
      downloadBtn: (count) => `📥 Ausgewählte herunterladen (${count})`,
      targetDir: (folder) => `📂 Ziel: Downloads/aliexpress/${folder}/`,
      allLoaded: "Alle Bestellungen geladen!",
      noWorkerPopup: "Bitte Pop-ups in Chrome für AliExpress erlauben!",
      loadingItem: (idx, total, name) => `[${idx}/${total}] Lade: ${name} ...`,
      finished: (folder) => `✅ Fertig! Gespeichert in: Downloads/aliexpress/${folder}/`,
      selectedBadge: (sel, vis) => `Ausgewählt: ${sel} von ${vis}`
    }
  };

  function detectLanguage() {
    try {
      const saved = localStorage.getItem("ali_inv_lang");
      if (saved && (saved === "de" || saved === "en")) return saved;
      const pageLang = (document.documentElement.lang || navigator.language || "").toLowerCase();
      return pageLang.startsWith("de") ? "de" : "en";
    } catch (e) {
      return "en";
    }
  }

  let currentLang = detectLanguage();
  function t(key, ...args) {
    const dict = I18N[currentLang] || I18N.en;
    const val = dict[key] !== undefined ? dict[key] : I18N.en[key] || key;
    return typeof val === "function" ? val(...args) : val;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function getTodayIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function parseAliDate(text) {
    if (!text) return "";
    // e.g. "24. Okt. 2024" or "24 Oct 2024"
    let m = text.match(/(\d{1,2})\.\s*([a-zA-ZäöüÄÖÜ]{3,4})\.?\s*(\d{4})/);
    if (m) {
      const day = m[1].padStart(2, "0");
      const monStr = m[2].toLowerCase();
      const year = m[3];
      const month = MONTH_MAP[monStr] || "01";
      return `${year}${month}${day}`;
    }
    // e.g. "Oct 24, 2024" or "Oct. 24, 2024"
    m = text.match(/([a-zA-Z]{3,4})\.?\s*(\d{1,2}),?\s*(\d{4})/);
    if (m) {
      const monStr = m[1].toLowerCase();
      const day = m[2].padStart(2, "0");
      const year = m[3];
      const month = MONTH_MAP[monStr] || "01";
      return `${year}${month}${day}`;
    }
    // e.g. "24 Oct 2024"
    m = text.match(/(\d{1,2})\s+([a-zA-Z]{3,4})\.?\s+(\d{4})/);
    if (m) {
      const day = m[1].padStart(2, "0");
      const monStr = m[2].toLowerCase();
      const year = m[3];
      const month = MONTH_MAP[monStr] || "01";
      return `${year}${month}${day}`;
    }
    // e.g. "2024-10-24" or "2024.10.24"
    m = text.match(/(\d{4})[-/.](\d{2})[-/.](\d{2})/);
    if (m) return `${m[1]}${m[2]}${m[3]}`;
    return "";
  }

  function sanitizeTitle(raw) {
    if (!raw) return "item";
    let s = raw.toLowerCase().trim();
    s = s.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
    s = s.replace(/(original|neu|new|hot|top|super|pro|plus|stk|stueck|pcs|pieces?|pack|set|lot|teile?_?satz|kostenloser? versand|free shipping|arrival|high quality)/gi, " ");
    s = s.replace(/(\d+)\s*(stk|pcs|pieces?|teile?|teilig|pack)/gi, " ");
    s = s.replace(/[^a-z0-9]+/g, "_");
    s = s.replace(/^_+|_+$/g, "");
    if (!s || s.length < 3) return "item";
    return s.slice(0, 35).replace(/_+$/, "");
  }

  function downloadViaTampermonkey(dataUrl, filename) {
    return new Promise((resolve) => {
      if (typeof GM_download === "function") {
        const subfolder = getTodayIso();
        const fullPath = `aliexpress/${subfolder}/${filename}`;
        GM_download({
          url: dataUrl,
          name: fullPath,
          saveAs: false,
          onload: () => resolve(true),
          onerror: (err) => {
            console.warn("GM_download failed, fallback to anchor:", err);
            fallbackAnchorDownload(dataUrl, filename);
            resolve(false);
          }
        });
      } else {
        fallbackAnchorDownload(dataUrl, filename);
        resolve(true);
      }
    });
  }

  function fallbackAnchorDownload(dataUrl, filename) {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /* ==========================================================================
     ORDER DETAIL PAGE LOGIC
     ========================================================================== */
  if (window.location.pathname.includes("/order/detail.html")) {
    window.addEventListener("DOMContentLoaded", initDetailPage);
    setTimeout(initDetailPage, 2500);

    let detailHandled = false;
    async function initDetailPage() {
      if (detailHandled) return;
      if (!window.location.hash.includes(AUTO_FLAG)) return;

      const urlParams = new URLSearchParams(window.location.search);
      const invDate = urlParams.get("inv_date") || "2026";
      const invName = urlParams.get("inv_name") || "item";
      const targetFilename = `${invDate}-${invName}.png`;

      detailHandled = true;
      console.log(`[Ali-Inv] Starting download for: ${targetFilename}`);

      let receiptBtn = null;
      for (let attempt = 0; attempt < 25; attempt++) {
        const buttons = document.querySelectorAll("button, a, div[role='button'], [data-pl='order_block_btn']");
        for (const btn of buttons) {
          const txt = (btn.innerText || btn.textContent || "").trim();
          if (RECEIPT_TEXTS.test(txt)) {
            receiptBtn = btn;
            break;
          }
        }
        if (receiptBtn) break;
        await sleep(350);
      }

      if (!receiptBtn) {
        console.warn("[Ali-Inv] Receipt button not found.");
        return;
      }

      receiptBtn.click();

      for (let attempt = 0; attempt < 35; attempt++) {
        await sleep(400);
        const iframes = document.querySelectorAll("iframe");
        for (const iframe of iframes) {
          try {
            const doc = iframe.contentDocument || iframe.contentWindow?.document;
            if (!doc) continue;
            const dlBtn = doc.querySelector("#download-receipt") || doc.querySelector("button[class*='download']");
            if (dlBtn) {
              await sleep(600);
              iframe.contentWindow.postMessage({ action: "ali_receipt_auto_dl", filename: targetFilename }, "*");
              return;
            }
          } catch (e) {}
        }
      }
    }

    window.addEventListener("message", (event) => {
      if (event.data?.action === "ali_receipt_dataurl") {
        const { dataUrl, filename } = event.data;
        downloadViaTampermonkey(dataUrl, filename);
      }
    });

    return;
  }

  /* ==========================================================================
     IFRAME TAX-UI INTERCEPTOR
     ========================================================================== */
  if (window.location.pathname.includes("/tax-ui/")) {
    window.addEventListener("message", async (event) => {
      if (event.data?.action === "ali_receipt_auto_dl") {
        const filename = event.data.filename || "receipt.png";
        const dlBtn = document.querySelector("#download-receipt") || document.querySelector("button[class*='download']");
        if (dlBtn) {
          const originalAppend = document.body.appendChild.bind(document.body);
          let intercepted = false;
          document.body.appendChild = function (elem) {
            if (elem && elem.tagName === "A" && elem.href && elem.href.startsWith("data:")) {
              intercepted = true;
              window.parent.postMessage({
                action: "ali_receipt_dataurl",
                dataUrl: elem.href,
                filename: filename
              }, "*");
              return elem;
            }
            return originalAppend(elem);
          };
          dlBtn.click();
          setTimeout(() => {
            document.body.appendChild = originalAppend;
            if (!intercepted) {
              const canvas = document.querySelector("canvas");
              if (canvas) {
                window.parent.postMessage({
                  action: "ali_receipt_dataurl",
                  dataUrl: canvas.toDataURL("image/png"),
                  filename: filename
                }, "*");
              }
            }
          }, 3500);
        }
      }
    });
    return;
  }

  /* ==========================================================================
     ORDER OVERVIEW: DASHBOARD, TABLE & AUTO-LOAD
     ========================================================================== */
  const selectedOrders = new Set();
  const ordersMap = new Map();
  let autoLoading = false;
  let isDashboardMinimized = false;
  let isPageCompacted = false;

  function injectCustomStyles() {
    if (document.getElementById("ali-inv-styles")) return;
    const style = document.createElement("style");
    style.id = "ali-inv-styles";
    style.textContent = `
      body.ali-compact-mode .order-item,
      body.ali-compact-mode [class*='order-item--root'],
      body.ali-compact-mode [class*='order-item-wrap'] {
        margin-bottom: 3px !important;
        padding: 4px 10px !important;
        border: 1px solid #e2e8f0 !important;
        box-shadow: none !important;
        height: 38px !important;
        overflow: hidden !important;
        display: flex !important;
        align-items: center !important;
      }
      body.ali-compact-mode .order-item-header {
        margin: 0 10px 0 0 !important;
        padding: 0 !important;
        border: none !important;
        font-size: 11px !important;
        display: flex !important;
        gap: 8px !important;
        flex-shrink: 0 !important;
      }
      body.ali-compact-mode .order-item-content {
        display: flex !important;
        align-items: center !important;
        gap: 10px !important;
        padding: 0 !important;
        margin: 0 !important;
        flex: 1 !important;
      }
      body.ali-compact-mode img {
        width: 26px !important;
        height: 26px !important;
        object-fit: cover !important;
      }
      .ali-table-row:hover { background: #f1f5f9; cursor: pointer; }
    `;
    document.head.appendChild(style);
  }

  function updateUiTexts() {
    const panel = document.getElementById("ali-inv-panel");
    if (!panel) return;

    panel.querySelector("#ali-inv-toggle-lang").textContent = t("langBtn");
    panel.querySelector("#ali-inv-title-text").textContent = `📦 ${t("title")}`;
    panel.querySelector("#ali-inv-autoload-btn").textContent = autoLoading ? t("stop") : t("loadMore");
    panel.querySelector("#ali-inv-toggle-compact").textContent = isPageCompacted ? t("normalView") : t("compactView");
    panel.querySelector("#ali-inv-search").placeholder = t("searchPlaceholder");
    panel.querySelector("#ali-inv-opt-all-years").textContent = t("allYears");
    panel.querySelector("#ali-inv-select-all").textContent = t("selectAll");
    panel.querySelector("#ali-inv-select-none").textContent = t("clearSelection");
    panel.querySelector("#ali-inv-th-date").textContent = t("colDate");
    panel.querySelector("#ali-inv-th-item").textContent = t("colItem");
    panel.querySelector("#ali-inv-th-price").textContent = t("colPrice");
    panel.querySelector("#ali-inv-status").textContent = t("targetDir", getTodayIso());
    updateCounterAndButton();
  }

  function createDashboard() {
    if (document.getElementById("ali-inv-panel")) return;
    injectCustomStyles();

    const panel = document.createElement("div");
    panel.id = "ali-inv-panel";
    panel.style.cssText = `
      position: fixed;
      top: 15px;
      right: 15px;
      z-index: 999999;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.18);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      width: 470px;
      padding: 14px;
      color: #1e293b;
      transition: all 0.2s ease-in-out;
    `;

    panel.innerHTML = `
      <div id="ali-inv-header" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;user-select:none;">
        <div id="ali-inv-title-text" style="font-weight:700;font-size:14px;display:flex;align-items:center;gap:6px;">
          📦 ${t("title")}
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          <button id="ali-inv-toggle-lang" style="background:#f1f5f9;border:1px solid #cbd5e1;cursor:pointer;font-size:11px;font-weight:700;padding:2px 6px;border-radius:4px;color:#334155;">
            ${t("langBtn")}
          </button>
          <span id="ali-inv-counter-badge" style="background:#e0f2fe;color:#0369a1;font-size:11px;font-weight:600;padding:2px 8px;border-radius:12px;">0 / 0</span>
          <button id="ali-inv-toggle-min" style="border:none;background:transparent;cursor:pointer;font-size:15px;padding:2px 6px;">➖</button>
        </div>
      </div>

      <div id="ali-inv-body" style="margin-top:12px;">
        <div style="display:flex;gap:6px;margin-bottom:10px;">
          <button id="ali-inv-autoload-btn" style="flex:1;padding:6px 8px;background:#f0f2f5;border:1px solid #d1d5db;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;">
            ${t("loadMore")}
          </button>
          <button id="ali-inv-toggle-compact" style="flex:1;padding:6px 8px;background:#f0f2f5;border:1px solid #d1d5db;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;">
            ${t("compactView")}
          </button>
        </div>

        <div style="display:flex;gap:6px;margin-bottom:8px;">
          <input type="text" id="ali-inv-search" placeholder="${t("searchPlaceholder")}" style="flex:2;padding:6px 8px;font-size:12px;border:1px solid #d1d5db;border-radius:6px;outline:none;">
          <select id="ali-inv-year" style="flex:1;padding:6px 4px;font-size:12px;border:1px solid #d1d5db;border-radius:6px;background:#fff;">
            <option value="" id="ali-inv-opt-all-years">${t("allYears")}</option>
            <option value="2026">2026</option>
            <option value="2025">2025</option>
            <option value="2024">2024</option>
          </select>
        </div>

        <div style="display:flex;gap:6px;margin-bottom:8px;">
          <button id="ali-inv-select-all" style="flex:1;padding:4px;background:#fff;border:1px solid #ddd;border-radius:4px;cursor:pointer;font-size:11px;">${t("selectAll")}</button>
          <button id="ali-inv-select-none" style="flex:1;padding:4px;background:#fff;border:1px solid #ddd;border-radius:4px;cursor:pointer;font-size:11px;">${t("clearSelection")}</button>
        </div>

        <div style="max-height:260px;overflow-y:auto;border:1px solid #e0e0e0;border-radius:6px;margin-bottom:10px;background:#fafafa;">
          <table style="width:100%;border-collapse:collapse;font-size:11px;text-align:left;">
            <thead style="position:sticky;top:0;background:#f4f5f7;border-bottom:1px solid #ddd;z-index:1;">
              <tr>
                <th style="padding:5px 4px;width:24px;text-align:center;"><input type="checkbox" id="ali-inv-th-cb" style="cursor:pointer;"></th>
                <th id="ali-inv-th-date" style="padding:5px 4px;width:68px;">${t("colDate")}</th>
                <th id="ali-inv-th-item" style="padding:5px 4px;">${t("colItem")}</th>
                <th id="ali-inv-th-price" style="padding:5px 4px;width:55px;text-align:right;">${t("colPrice")}</th>
              </tr>
            </thead>
            <tbody id="ali-inv-tbody">
            </tbody>
          </table>
        </div>

        <button id="ali-inv-dl-btn" style="width:100%;padding:9px;background:#e4393c;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:bold;font-size:13px;">
          ${t("downloadBtn", 0)}
        </button>
        <div id="ali-inv-progress-wrap" style="display:none;margin-top:8px;background:#e2e8f0;border-radius:6px;height:16px;overflow:hidden;position:relative;box-shadow:inset 0 1px 2px rgba(0,0,0,0.1);">
          <div id="ali-inv-progress-fill" style="width:0%;height:100%;background:linear-gradient(90deg, #e4393c, #ff6b6b);transition:width 0.4s ease;border-radius:6px;"></div>
          <span id="ali-inv-progress-text" style="position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:bold;color:#1e293b;text-shadow:0 0 2px rgba(255,255,255,0.8);">0%</span>
        </div>
        <div id="ali-inv-status" style="margin-top:6px;font-size:11px;color:#2e7d32;text-align:center;font-weight:500;">
          ${t("targetDir", getTodayIso())}
        </div>
      </div>
    `;

    document.body.appendChild(panel);

    const minBtn = panel.querySelector("#ali-inv-toggle-min");
    const bodyEl = panel.querySelector("#ali-inv-body");
    const toggleMinimize = (forceState) => {
      isDashboardMinimized = forceState !== undefined ? forceState : !isDashboardMinimized;
      if (isDashboardMinimized) {
        bodyEl.style.display = "none";
        panel.style.width = "auto";
        panel.style.padding = "8px 12px";
        minBtn.textContent = "➕";
      } else {
        bodyEl.style.display = "block";
        panel.style.width = "470px";
        panel.style.padding = "14px";
        minBtn.textContent = "➖";
      }
    };
    minBtn.onclick = (e) => { e.stopPropagation(); toggleMinimize(); };
    panel.querySelector("#ali-inv-header").onclick = (e) => {
      if (e.target.id === "ali-inv-toggle-lang") return;
      if (isDashboardMinimized) toggleMinimize(false);
    };

    const langBtn = panel.querySelector("#ali-inv-toggle-lang");
    langBtn.onclick = (e) => {
      e.stopPropagation();
      currentLang = currentLang === "de" ? "en" : "de";
      try { localStorage.setItem("ali_inv_lang", currentLang); } catch (err) {}
      updateUiTexts();
    };

    const autoloadBtn = panel.querySelector("#ali-inv-autoload-btn");
    autoloadBtn.onclick = () => {
      autoLoading = !autoLoading;
      if (autoLoading) {
        autoloadBtn.textContent = t("stop");
        autoloadBtn.style.background = "#ffebee";
        autoloadBtn.style.color = "#c62828";
        runAutoLoad();
      } else {
        autoloadBtn.textContent = t("loadMore");
        autoloadBtn.style.background = "#f0f2f5";
        autoloadBtn.style.color = "#333";
      }
    };

    const compactToggleBtn = panel.querySelector("#ali-inv-toggle-compact");
    compactToggleBtn.onclick = () => {
      isPageCompacted = !isPageCompacted;
      document.body.classList.toggle("ali-compact-mode", isPageCompacted);
      compactToggleBtn.textContent = isPageCompacted ? t("normalView") : t("compactView");
      compactToggleBtn.style.background = isPageCompacted ? "#e8f5e9" : "#f0f2f5";
    };

    panel.querySelector("#ali-inv-search").oninput = applyFilter;
    panel.querySelector("#ali-inv-year").onchange = applyFilter;

    panel.querySelector("#ali-inv-th-cb").onchange = (e) => {
      const checked = e.target.checked;
      panel.querySelectorAll(".ali-table-row").forEach((tr) => {
        if (tr.style.display !== "none") {
          const oid = tr.dataset.oid;
          if (checked) selectedOrders.add(oid);
          else selectedOrders.delete(oid);
          const cb = tr.querySelector(".ali-table-cb");
          if (cb) cb.checked = checked;
        }
      });
      syncMainPageCheckboxes();
      updateCounterAndButton();
    };

    panel.querySelector("#ali-inv-select-all").onclick = () => {
      panel.querySelector("#ali-inv-th-cb").checked = true;
      panel.querySelector("#ali-inv-th-cb").dispatchEvent(new Event("change"));
    };

    panel.querySelector("#ali-inv-select-none").onclick = () => {
      selectedOrders.clear();
      panel.querySelector("#ali-inv-th-cb").checked = false;
      panel.querySelectorAll(".ali-table-cb").forEach((cb) => (cb.checked = false));
      syncMainPageCheckboxes();
      updateCounterAndButton();
    };

    panel.querySelector("#ali-inv-dl-btn").onclick = startDownloadBatch;
  }

  async function runAutoLoad() {
    while (autoLoading) {
      const moreBtn = findMoreButton();
      if (!moreBtn) {
        document.querySelector("#ali-inv-status").textContent = t("allLoaded");
        document.querySelector("#ali-inv-autoload-btn").click();
        break;
      }
      moreBtn.scrollIntoView({ behavior: "smooth", block: "center" });
      moreBtn.click();
      await sleep(1800);
      collectOrders();
    }
  }

  function findMoreButton() {
    const btns = document.querySelectorAll("button, div[role='button'], a");
    for (const b of btns) {
      const txt = (b.textContent || "").trim().toLowerCase();
      if (
        txt.includes("weitere bestellungen") ||
        txt.includes("view more orders") ||
        txt.includes("mehr anzeigen") ||
        txt.includes("show more") ||
        txt.includes("load more")
      ) {
        return b;
      }
    }
    return null;
  }

  function collectOrders() {
    const cards = document.querySelectorAll(".order-item, [class*='order-item--root'], [class*='order-item-wrap']");
    let newlyAdded = false;

    cards.forEach((card) => {
      let orderId = "";
      const idMatch = card.innerHTML.match(/orderId=(\d{12,25})/);
      if (idMatch) {
        orderId = idMatch[1];
      } else {
        const textMatch = card.innerText.match(/(\d{15,20})/);
        if (textMatch) orderId = textMatch[1];
      }
      if (!orderId) return;

      const dateMatch = parseAliDate(card.innerText);
      const orderDate = dateMatch || getTodayIso().replace(/-/g, "");

      let bestTitle = "";
      const contentArea = card.querySelector(".order-item-content") || card;
      const candidates = [];

      contentArea.querySelectorAll("a, span, p, div").forEach((el) => {
        if (el.children.length === 0) {
          const t = (el.innerText || el.textContent || "").trim();
          if (
            t.length >= 8 &&
            !/^(\$|€|chf|gbp|rub|\d+[.,]\d{2})/i.test(t) &&
            !/^(kopieren|copy|bestellung|order|details?|tracking|reorder|track order|view details)/i.test(t) &&
            !t.includes("store") &&
            !t.includes("Store")
          ) {
            candidates.push(t);
          }
        }
      });

      candidates.sort((a, b) => b.length - a.length);
      if (candidates.length > 0) {
        bestTitle = candidates[0];
      } else {
        bestTitle = `Ali_Order_${orderId.slice(-6)}`;
      }

      const shortName = sanitizeTitle(bestTitle);

      let price = "";
      const pMatch = card.innerText.match(/(€\s*[\d.,]+|CHF\s*[\d.,]+|\$\s*[\d.,]+|£\s*[\d.,]+|[\d.,]+\s*€)/);
      if (pMatch) price = pMatch[1].trim();

      if (!ordersMap.has(orderId)) {
        ordersMap.set(orderId, {
          id: orderId,
          date: orderDate,
          title: bestTitle,
          shortName: shortName,
          price: price,
          cardElement: card
        });
        newlyAdded = true;
      }

      if (!card.querySelector(".ali-card-cb")) {
        const header = card.querySelector(".order-item-header") || card.firstElementChild;
        if (header) {
          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.className = "ali-card-cb";
          cb.dataset.oid = orderId;
          cb.style.cssText = "margin-right: 8px; transform: scale(1.15); cursor: pointer;";
          cb.checked = selectedOrders.has(orderId);
          cb.onchange = (e) => {
            if (e.target.checked) selectedOrders.add(orderId);
            else selectedOrders.delete(orderId);
            syncTableCheckboxes();
            updateCounterAndButton();
          };
          header.prepend(cb);
        }
      }
    });

    if (newlyAdded) {
      renderTable();
    }
  }

  function renderTable() {
    const tbody = document.getElementById("ali-inv-tbody");
    if (!tbody) return;

    tbody.innerHTML = "";
    const sorted = Array.from(ordersMap.values()).sort((a, b) => b.date.localeCompare(a.date));

    sorted.forEach((info) => {
      const tr = document.createElement("tr");
      tr.className = "ali-table-row";
      tr.dataset.oid = info.id;
      tr.style.cssText = "border-bottom: 1px solid #f0f0f0;";

      tr.onclick = (e) => {
        if (e.target.tagName !== "INPUT") {
          info.cardElement.scrollIntoView({ behavior: "smooth", block: "center" });
          info.cardElement.style.outline = "2px solid #e4393c";
          setTimeout(() => (info.cardElement.style.outline = "none"), 2000);
        }
      };

      const dDisplay = info.date.length === 8 ? `${info.date.slice(6, 8)}.${info.date.slice(4, 6)}.${info.date.slice(0, 4)}` : info.date;

      tr.innerHTML = `
        <td style="padding:4px;text-align:center;">
          <input type="checkbox" class="ali-table-cb" data-oid="${info.id}" ${selectedOrders.has(info.id) ? "checked" : ""} style="cursor:pointer;">
        </td>
        <td style="padding:4px;white-space:nowrap;color:#64748b;">${dDisplay}</td>
        <td style="padding:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:210px;" title="${info.title}">
          ${info.shortName}
        </td>
        <td style="padding:4px;text-align:right;white-space:nowrap;font-weight:600;color:#0f172a;">${info.price}</td>
      `;

      const cb = tr.querySelector(".ali-table-cb");
      cb.onchange = (e) => {
        if (e.target.checked) selectedOrders.add(info.id);
        else selectedOrders.delete(info.id);
        syncMainPageCheckboxes();
        updateCounterAndButton();
      };

      tbody.appendChild(tr);
    });

    applyFilter();
  }

  function applyFilter() {
    const searchVal = (document.getElementById("ali-inv-search")?.value || "").toLowerCase().trim();
    const yearVal = document.getElementById("ali-inv-year")?.value || "";

    let visibleCount = 0;
    document.querySelectorAll(".ali-table-row").forEach((tr) => {
      const oid = tr.dataset.oid;
      const info = ordersMap.get(oid);
      if (!info) return;

      const matchesYear = !yearVal || info.date.startsWith(yearVal);
      const matchesSearch =
        !searchVal ||
        info.shortName.toLowerCase().includes(searchVal) ||
        info.title.toLowerCase().includes(searchVal) ||
        info.id.includes(searchVal) ||
        info.price.toLowerCase().includes(searchVal);

      if (matchesYear && matchesSearch) {
        tr.style.display = "";
        visibleCount++;
      } else {
        tr.style.display = "none";
      }
    });

    updateCounterAndButton(visibleCount);
  }

  function syncMainPageCheckboxes() {
    document.querySelectorAll(".ali-card-cb").forEach((cb) => {
      cb.checked = selectedOrders.has(cb.dataset.oid);
    });
  }

  function syncTableCheckboxes() {
    document.querySelectorAll(".ali-table-cb").forEach((cb) => {
      cb.checked = selectedOrders.has(cb.dataset.oid);
    });
  }

  function updateCounterAndButton(visibleCount) {
    const currentVisible = visibleCount !== undefined ? visibleCount : document.querySelectorAll(".ali-table-row:not([style*='display: none'])").length;

    const badge = document.getElementById("ali-inv-counter-badge");
    if (badge) {
      badge.textContent = t("selectedBadge", selectedOrders.size, currentVisible);
    }

    const dlBtn = document.getElementById("ali-inv-dl-btn");
    if (dlBtn) {
      dlBtn.textContent = t("downloadBtn", selectedOrders.size);
      dlBtn.disabled = selectedOrders.size === 0;
      dlBtn.style.opacity = selectedOrders.size === 0 ? "0.6" : "1";
    }
  }

  async function startDownloadBatch() {
    const ids = Array.from(selectedOrders);
    if (ids.length === 0) return;

    const statusEl = document.getElementById("ali-inv-status");
    const dlBtn = document.getElementById("ali-inv-dl-btn");
    const progressWrap = document.getElementById("ali-inv-progress-wrap");
    const progressFill = document.getElementById("ali-inv-progress-fill");
    const progressText = document.getElementById("ali-inv-progress-text");

    dlBtn.disabled = true;

    if (progressWrap) {
      progressWrap.style.display = "block";
      progressFill.style.width = "0%";
      progressFill.style.background = "linear-gradient(90deg, #e4393c, #ff6b6b)";
      progressText.textContent = `0 / ${ids.length} (0%)`;
    }

    const worker = window.open("about:blank", "ali_worker_window");
    if (!worker) {
      alert(t("noWorkerPopup"));
      dlBtn.disabled = false;
      return;
    }

    for (let i = 0; i < ids.length; i++) {
      const info = ordersMap.get(ids[i]);
      if (!info) continue;

      const currentPct = Math.round((i / ids.length) * 100);
      if (progressFill) progressFill.style.width = `${currentPct}%`;
      if (progressText) progressText.textContent = `${i} / ${ids.length} (${currentPct}%)`;

      statusEl.textContent = t("loadingItem", i + 1, ids.length, info.shortName);

      const url = `${window.location.origin}/p/order/detail.html?orderId=${info.id}&inv_date=${info.date}&inv_name=${encodeURIComponent(info.shortName)}#${AUTO_FLAG}`;
      worker.location.href = url;
      await sleep(11500);

      const donePct = Math.round(((i + 1) / ids.length) * 100);
      if (progressFill) progressFill.style.width = `${donePct}%`;
      if (progressText) progressText.textContent = `${i + 1} / ${ids.length} (${donePct}%)`;
    }

    try { worker.close(); } catch (e) {}
    if (progressFill) progressFill.style.background = "#2e7d32";
    statusEl.textContent = t("finished", getTodayIso());
    dlBtn.disabled = false;
  }

  createDashboard();
  setInterval(() => {
    createDashboard();
    collectOrders();
  }, 1500);
})();
