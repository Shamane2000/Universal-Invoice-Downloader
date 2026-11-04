// ==UserScript==
// @name         Amazon Pro Invoice Downloader (v0.4.8 Final-Paging)
// @namespace    https://github.com/Shamane2000
// @version      0.4.8
// @description  Automatisierter PDF-Rechnungs-Download für Amazon mit Link-basierter Container-Erkennung, 100% Paginierung (85 Bestellungen) & sauberem Kompakt-Modus
// @match        https://*.amazon.de/*order*
// @match        https://*.amazon.com/*order*
// @grant        GM_download
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function () {
  "use strict";

  const MONTH_MAP = {
    januar: "01", jan: "01", februar: "02", feb: "02",
    märz: "03", mär: "03", mar: "03", april: "04", apr: "04",
    mai: "05", may: "05", juni: "06", jun: "06",
    juli: "07", jul: "07", august: "08", aug: "08",
    september: "09", sep: "09", oktober: "10", okt: "10", oct: "10",
    november: "11", nov: "11", dezember: "12", dez: "12", dec: "12"
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function cleanString(str) {
    if (!str) return "";
    return str.replace(/[\u200B-\u200D\uFEFF\u200E\u200F]/g, "").replace(/\s+/g, " ").trim();
  }

  function parseAmazonDate(text) {
    if (!text) return "20260101";
    const cleaned = cleanString(text);
    const m = cleaned.match(/(\d{1,2})\.\s*([a-zA-ZäöüÄÖÜ]{3,12})\.?\s*(\d{4})/);
    if (m) {
      const day = m[1].padStart(2, "0");
      const mon = MONTH_MAP[m[2].toLowerCase()] || "01";
      const year = m[3];
      return `${year}${mon}${day}`;
    }
    const isoMatch = cleaned.match(/(\d{4})[-/.](\d{2})[-/.](\d{2})/);
    if (isoMatch) return `${isoMatch[1]}${isoMatch[2]}${isoMatch[3]}`;
    return "20260101";
  }

  function sanitizeTitle(raw) {
    if (!raw) return "artikel";
    let s = cleanString(raw).toLowerCase();
    s = s.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
    s = s.replace(/\b(original|neu|new|pro|plus|stk|stueck|pcs|pack|set)\b/gi, " ");
    s = s.replace(/[^a-z0-9]+/g, "_");
    s = s.replace(/^_+|_+$/g, "");
    return s.slice(0, 32).replace(/_+$/, "") || "artikel";
  }

  const selectedOrders = new Set();
  const ordersMap = new Map();
  const paginationDiagnostics = [];
  let isDashboardMinimized = false;
  let isPageCompacted = false;
  let isLoadingBackground = false;

  /* ==========================================================================
     CSS STYLES: SAUBERER KOMPAKT-MODUS
     ========================================================================== */
  function injectStyles() {
    if (document.getElementById("amz-inv-styles")) return;
    const style = document.createElement("style");
    style.id = "amz-inv-styles";
    style.textContent = `
      body.amz-compact-mode .order-card,
      body.amz-compact-mode .js-order-card,
      body.amz-compact-mode .a-box-group {
        margin-bottom: 6px !important;
        border: 1px solid #cbd5e1 !important;
        border-radius: 6px !important;
        box-shadow: none !important;
      }
      body.amz-compact-mode .order-header,
      body.amz-compact-mode .yohtmlc-order-header,
      body.amz-compact-mode .a-box-header {
        padding: 4px 12px !important;
        font-size: 11px !important;
        background: #f8fafc !important;
      }
      body.amz-compact-mode .yohtmlc-recipient {
        display: none !important;
      }
      body.amz-compact-mode .yohtmlc-item {
        padding: 4px 12px !important;
      }
      body.amz-compact-mode .yohtmlc-item img,
      body.amz-compact-mode .order-card img {
        width: 32px !important;
        height: 32px !important;
        object-fit: contain !important;
      }
      /* Alle Buttons im Bestellbereich (Nochmals kaufen, Support, Verfolgen etc.) zuverlässig ausblenden */
      body.amz-compact-mode .a-box-group .a-button,
      body.amz-compact-mode .order-card .a-button,
      body.amz-compact-mode .yohtmlc-item .a-button,
      body.amz-compact-mode .order-card .a-fixed-right-grid-col.a-col-right,
      body.amz-compact-mode .yohtmlc-item .a-fixed-right-grid-col.a-col-right,
      body.amz-compact-mode [class*="shipment-status-action"],
      body.amz-compact-mode [class*="buy-again"],
      body.amz-compact-mode [class*="return-window"],
      body.amz-compact-mode [class*="warranty"],
      body.amz-compact-mode [class*="support"] {
        display: none !important;
      }
      body.amz-compact-mode .order-card .a-fixed-right-grid-col.a-col-left,
      body.amz-compact-mode .yohtmlc-item .a-fixed-right-grid-col.a-col-left {
        width: 100% !important;
        padding-right: 0 !important;
        float: none !important;
      }
      /* Dashboard vor Kompakt-Styles schützen */
      #amz-inv-panel * {
        box-sizing: border-box;
      }
      #amz-inv-panel button {
        display: flex !important;
      }
      .amz-table-row:hover { background: #f0f4f8; cursor: pointer; }
    `;
    document.head.appendChild(style);
  }

  /* ==========================================================================
     NETZWERK: GM_xmlhttpRequest MIT FALLBACK
     ========================================================================== */
  function requestHtml(url) {
    return new Promise((resolve) => {
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
          onerror: (err) => {
            resolve({
              ok: false,
              status: 0,
              finalUrl: url,
              text: "",
              error: err ? (err.error || err.statusText || "GM_xhr Error") : "GM_xhr Error",
              via: "GM_xmlhttpRequest"
            });
          },
          ontimeout: () => {
            resolve({
              ok: false,
              status: 0,
              finalUrl: url,
              text: "",
              error: "Timeout",
              via: "GM_xmlhttpRequest"
            });
          }
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
          .catch((err) => {
            resolve({
              ok: false,
              status: 0,
              finalUrl: url,
              text: "",
              error: err.message,
              via: "fetch"
            });
          });
      }
    });
  }

  /* ==========================================================================
     BESTELLUNGEN PARSEN (ISOLIERTER CONTAINER PRO DETAIL-LINK)
     ========================================================================== */
  function extractOrdersFromDoc(doc, isLivePage = false) {
    let newlyAddedCount = 0;
    const extractedIds = [];
    const orderContainersMap = new Map();

    // Strategie 1: Jede Bestellung besitzt einen eindeutigen "Bestelldetails anzeigen" Link mit der echten ID
    const candidateLinks = Array.from(doc.querySelectorAll("a[href*='orderID='], a[href*='orderId='], a[href*='order-details'], [data-order-id]"));
    for (const el of candidateLinks) {
      const src = el.getAttribute("href") || el.getAttribute("data-order-id") || "";
      const m = src.match(/(\d{3}-\d{7}-\d{7})/);
      if (m) {
        const oid = m[1];
        if (!orderContainersMap.has(oid)) {
          // Den isolierten übergeordneten Box-Container der einzelnen Bestellung finden
          const container = el.closest(".a-box-group, .order-card, .js-order-card, .order, div[data-component='orderCard']") || el.closest(".a-box")?.parentElement;
          if (container) {
            orderContainersMap.set(oid, container);
          }
        }
      }
    }

    // Strategie 2 (Fallback): Falls keine Links gefunden wurden, über Box-Container gehen
    if (orderContainersMap.size === 0) {
      const fallbackCards = Array.from(doc.querySelectorAll(".a-box-group, .order-card, .js-order-card, div[data-component='orderCard']"));
      fallbackCards.forEach((c) => {
        const topContainer = c.closest(".a-box-group") || c;
        const htmlMatch = (topContainer.innerHTML || "").match(/(\d{3}-\d{7}-\d{7})/);
        const textMatch = cleanString(topContainer.textContent || "").match(/(\d{3}-\d{7}-\d{7})/);
        const oid = htmlMatch ? htmlMatch[1] : (textMatch ? textMatch[1] : "");
        if (oid && !orderContainersMap.has(oid)) {
          orderContainersMap.set(oid, topContainer);
        }
      });
    }

    // Nun jeden isolierten Container einzeln auswerten
    orderContainersMap.forEach((container, orderId) => {
      extractedIds.push(orderId);

      const cleanContainerText = cleanString(container.textContent || container.innerText || "");
      const isCancelled = /storniert|cancelled/i.test(cleanContainerText);
      const isRefunded = /erstattet|refunded/i.test(cleanContainerText);

      // Datum
      const dateMatch = cleanContainerText.match(/(\d{1,2}\.\s+[a-zA-ZäöüÄÖÜ]+\s+\d{4})/);
      const rawDate = dateMatch ? dateMatch[1] : "";
      const isoDate = parseAmazonDate(rawDate);

      // Titel
      let title = "";
      const productLinks = Array.from(container.querySelectorAll("a[href*='/dp/'], a[href*='asin_title'], a[href*='/gp/product/']"));
      for (const a of productLinks) {
        const txt = cleanString(a.textContent || a.innerText || "");
        if (txt.length > 5 && !/nochmals|locker|verfolgen|rueckgabe|bewert|widerruf|frage/i.test(txt)) {
          title = txt;
          break;
        }
      }

      if (!title) {
        const img = container.querySelector("img[alt]");
        if (img && img.alt && cleanString(img.alt).length > 4) {
          title = cleanString(img.alt);
        }
      }

      if (!title || /frank|hertzschuch|adresse|locker/i.test(title)) {
        title = `Amazon_Bestellung_${orderId.slice(-7)}`;
      }

      const shortName = sanitizeTitle(title);

      // Preis / Stornierung
      let price = "";
      if (isCancelled) {
        price = "Storniert";
      } else {
        const pMatch = cleanContainerText.match(/(€\s*[\d.,]+|EUR\s*[\d.,]+|[\d.,]+\s*€)/i);
        if (pMatch) price = pMatch[1].trim();
        if (isRefunded && price) price += " (Erstattet)";
      }
      if (!price) price = isCancelled ? "Storniert" : "-";

      // Popover-Rechnungs-URL
      let popoverUrl = "";
      if (!isCancelled) {
        const invoiceLink = Array.from(container.querySelectorAll("a, span[data-action]")).find(el => 
          /rechnung/i.test(el.textContent || "") || 
          (el.getAttribute("href") || "").includes("invoice")
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
          const rawMatch = (container.innerHTML || "").match(/["'](\/your-orders\/[^"']*invoice[^"']*)["']/);
          if (rawMatch) popoverUrl = rawMatch[1];
        }

        if (!popoverUrl) {
          popoverUrl = `/your-orders/invoice/popover?orderId=${orderId}`;
        }
      }

      if (!ordersMap.has(orderId)) {
        ordersMap.set(orderId, {
          id: orderId,
          date: isoDate,
          rawDate: rawDate,
          title: title,
          shortName: shortName,
          price: price,
          popoverUrl: popoverUrl,
          cardElement: isLivePage ? container : null
        });
        newlyAddedCount++;
      }

      if (isLivePage && !container.querySelector(".amz-card-cb")) {
        const header = container.querySelector(".order-header, .yohtmlc-order-header, .a-box-header") || container.firstElementChild;
        if (header) {
          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.className = "amz-card-cb";
          cb.dataset.oid = orderId;
          cb.style.cssText = "margin-right: 8px; transform: scale(1.15); cursor: pointer; vertical-align: middle;";
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

    if (newlyAddedCount > 0) {
      renderTable();
    }

    return {
      cardsFound: orderContainersMap.size,
      extractedIds: extractedIds,
      newlyAddedCount: newlyAddedCount
    };
  }

  function collectOrders() {
    extractOrdersFromDoc(document, true);
  }

  /* ==========================================================================
     DASHBOARD UI
     ========================================================================== */
  function createDashboard() {
    if (document.getElementById("amz-inv-panel")) return;
    injectStyles();

    const panel = document.createElement("div");
    panel.id = "amz-inv-panel";
    panel.style.cssText = `
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
    `;

    panel.innerHTML = `
      <div id="amz-inv-header" style="display:flex; justify-content:space-between; align-items:center; cursor:move; user-select:none; margin-bottom:12px; padding-bottom:8px; border-bottom:1px solid #e7e7e7;">
        <div style="font-weight:700; font-size:15px; display:flex; align-items:center; gap:8px;">
          <span>📦</span>
          <span>Amazon Rechnungs-Manager</span>
          <button id="amz-inv-copy-debug" style="font-size:11px; padding:2px 6px; border:1px solid #cbd5e1; border-radius:4px; background:#f8fafc; cursor:pointer;" title="Debug-Daten in Zwischenablage kopieren">📋 Debug</button>
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
          <span id="amz-inv-counter-badge" style="font-size:11px; font-weight:600; background:#e0f2fe; color:#0369a1; padding:3px 8px; border-radius:12px;">
            Ausgewählt: 0 von 0
          </span>
          <button id="amz-inv-min-btn" style="background:none; border:none; font-size:16px; cursor:pointer; padding:0 4px; color:#555;">➖</button>
        </div>
      </div>

      <div id="amz-inv-body">
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; margin-bottom:10px;">
          <button id="amz-inv-load-btn" style="padding:7px 10px; background:#f0f2f5; border:1px solid #d1d5db; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px;">
            🔄 Alle Seiten nachladen
          </button>
          <button id="amz-inv-toggle-compact" style="padding:7px 10px; background:#f0f2f5; border:1px solid #d1d5db; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px;">
            👁 Seite kompaktieren
          </button>
        </div>

        <div style="display:flex; gap:8px; margin-bottom:10px;">
          <input type="text" id="amz-inv-search" placeholder="🔍 Suche (Artikel, ID, Betrag)..." style="flex:1; padding:6px 10px; border:1px solid #d1d5db; border-radius:6px; font-size:12px; outline:none;">
          <select id="amz-inv-year" style="padding:6px 10px; border:1px solid #d1d5db; border-radius:6px; font-size:12px; background:#fff; font-weight:600; cursor:pointer;">
            <option value="last30">Letzte 30 Tage</option>
            <option value="months-3">Letzte 3 Monate</option>
            <option value="year-2026">2026</option>
            <option value="year-2025" selected>2025</option>
            <option value="year-2024">2024</option>
            <option value="year-2023">2023</option>
          </select>
        </div>

        <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
          <button id="amz-inv-select-all" style="flex:1; margin-right:4px; padding:5px; background:#fff; border:1px solid #d1d5db; border-radius:4px; font-size:11px; cursor:pointer;">☑️ Alle gefilterten</button>
          <button id="amz-inv-select-none" style="flex:1; margin-left:4px; padding:5px; background:#fff; border:1px solid #d1d5db; border-radius:4px; font-size:11px; cursor:pointer;">◻️ Auswahl leeren</button>
        </div>

        <div style="max-height:260px; overflow-y:auto; border:1px solid #e2e8f0; border-radius:6px; margin-bottom:12px; background:#fafafa;">
          <table style="width:100%; border-collapse:collapse; font-size:11px; text-align:left;">
            <thead style="background:#f1f5f9; position:sticky; top:0; z-index:10; border-bottom:1px solid #cbd5e1;">
              <tr>
                <th style="padding:5px; width:24px; text-align:center;"><input type="checkbox" id="amz-inv-th-cb" style="cursor:pointer;"></th>
                <th style="padding:5px; width:75px;">Datum</th>
                <th style="padding:5px;">Artikel</th>
                <th style="padding:5px; width:65px; text-align:right;">Betrag</th>
              </tr>
            </thead>
            <tbody id="amz-inv-tbody">
              <!-- Dynamische Tabellenzeilen -->
            </tbody>
          </table>
        </div>

        <div id="amz-inv-progress-wrap" style="display:none; margin-bottom:10px;">
          <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:4px; color:#475569;">
            <span id="amz-inv-progress-label">Download-Fortschritt</span>
            <span id="amz-inv-progress-text">0%</span>
          </div>
          <div style="width:100%; height:6px; background:#e2e8f0; border-radius:3px; overflow:hidden;">
            <div id="amz-inv-progress-fill" style="width:0%; height:100%; background:#ff9900; transition:width 0.2s;"></div>
          </div>
        </div>

        <div style="display:flex; gap:8px;">
          <button id="amz-inv-dl-btn" style="flex:2; padding:9px; background:linear-gradient(to bottom, #f7dfa5, #f0c14b); border:1px solid #a88734; border-radius:6px; font-weight:700; font-size:13px; color:#111; cursor:pointer; box-shadow:0 1px 2px rgba(0,0,0,0.1);">
            📥 Ausgewählte PDFs laden (0)
          </button>
          <button id="amz-inv-test-btn" style="flex:1; padding:9px; background:#f0f2f5; border:1px solid #d1d5db; border-radius:6px; font-weight:600; font-size:12px; color:#111; cursor:pointer;" title="Lädt nur die 1. markierte Bestellung zum Testen">
            🧪 Test (#1)
          </button>
        </div>

        <div id="amz-inv-status" style="margin-top:8px; font-size:11px; color:#555; text-align:center; min-height:16px;"></div>
      </div>
    `;

    document.body.appendChild(panel);

    // Minimize / Expand
    const minBtn = panel.querySelector("#amz-inv-min-btn");
    const bodyEl = panel.querySelector("#amz-inv-body");
    const toggleMinimize = (forceState) => {
      isDashboardMinimized = forceState !== undefined ? forceState : !isDashboardMinimized;
      if (isDashboardMinimized) {
        bodyEl.style.display = "none";
        panel.style.width = "auto";
        panel.style.padding = "8px 14px";
        minBtn.textContent = "➕";
      } else {
        bodyEl.style.display = "block";
        panel.style.width = "490px";
        panel.style.padding = "14px";
        minBtn.textContent = "➖";
      }
    };
    minBtn.onclick = (e) => { e.stopPropagation(); toggleMinimize(); };
    panel.querySelector("#amz-inv-header").onclick = (e) => { 
      if (e.target.id === "amz-inv-copy-debug") return;
      if (isDashboardMinimized) toggleMinimize(false); 
    };

    panel.querySelector("#amz-inv-copy-debug").onclick = copyDebugData;
    panel.querySelector("#amz-inv-load-btn").onclick = handleDirectPaginationLinks;
    panel.querySelector("#amz-inv-test-btn").onclick = runSingleTestDownload;

    const compactToggleBtn = panel.querySelector("#amz-inv-toggle-compact");
    compactToggleBtn.onclick = () => {
      isPageCompacted = !isPageCompacted;
      document.body.classList.toggle("amz-compact-mode", isPageCompacted);
      compactToggleBtn.textContent = isPageCompacted ? "👁 Normale Ansicht" : "👁 Seite kompaktieren";
      compactToggleBtn.style.background = isPageCompacted ? "#e8f5e9" : "#f0f2f5";
    };

    panel.querySelector("#amz-inv-search").oninput = applyFilter;
    
    // Jahresauswahl
    const yearSelect = panel.querySelector("#amz-inv-year");
    const urlParams = new URLSearchParams(window.location.search);
    const currentTimeFilter = urlParams.get("timeFilter") || "";
    if (currentTimeFilter) {
      for (let opt of yearSelect.options) {
        if (opt.value === currentTimeFilter) {
          yearSelect.value = currentTimeFilter;
          break;
        }
      }
    }
    yearSelect.onchange = (e) => {
      const val = e.target.value;
      if (val) {
        const targetUrl = new URL(window.location.href);
        targetUrl.searchParams.set("timeFilter", val);
        targetUrl.searchParams.delete("page");
        targetUrl.searchParams.delete("startIndex");
        window.location.href = targetUrl.toString();
      }
    };

    panel.querySelector("#amz-inv-th-cb").onchange = (e) => {
      const checked = e.target.checked;
      panel.querySelectorAll(".amz-table-row").forEach((tr) => {
        if (tr.style.display !== "none") {
          const oid = tr.dataset.oid;
          if (checked) selectedOrders.add(oid);
          else selectedOrders.delete(oid);
          const cb = tr.querySelector(".amz-table-cb");
          if (cb) cb.checked = checked;
        }
      });
      syncMainPageCheckboxes();
      updateCounterAndButton();
    };

    panel.querySelector("#amz-inv-select-all").onclick = () => {
      panel.querySelector("#amz-inv-th-cb").checked = true;
      panel.querySelector("#amz-inv-th-cb").dispatchEvent(new Event("change"));
    };

    panel.querySelector("#amz-inv-select-none").onclick = () => {
      selectedOrders.clear();
      panel.querySelector("#amz-inv-th-cb").checked = false;
      panel.querySelectorAll(".amz-table-cb").forEach((cb) => (cb.checked = false));
      syncMainPageCheckboxes();
      updateCounterAndButton();
    };

    panel.querySelector("#amz-inv-dl-btn").onclick = startDownloadBatch;
  }

  /* ==========================================================================
     DIAGNOSE-FUNKTION
     ========================================================================== */
  function copyDebugData() {
    const btn = document.getElementById("amz-inv-copy-debug");
    const paginationLinks = Array.from(document.querySelectorAll(".a-pagination a")).map(a => ({
      txt: (a.textContent || "").trim(),
      href: a.getAttribute("href")
    }));

    const liveCards = document.querySelectorAll(".a-box-group, .order-card, .js-order-card");

    const debug = {
      orderCount: ordersMap.size,
      livePage: {
        title: document.title,
        url: window.location.href,
        liveCardCount: liveCards.length,
        hasGM_xmlhttpRequest: typeof GM_xmlhttpRequest === "function",
        paginationLinksFound: paginationLinks
      },
      paginationDiagnostics: paginationDiagnostics,
      ordersSample: Array.from(ordersMap.values()).slice(0, 10).map(o => ({
        id: o.id, date: o.date, name: o.shortName, price: o.price, popover: !!o.popoverUrl
      }))
    };

    const str = JSON.stringify(debug, null, 2);
    if (typeof GM_setClipboard === "function") {
      GM_setClipboard(str);
    } else {
      navigator.clipboard.writeText(str);
    }
    const orig = btn.textContent;
    btn.textContent = "✅ Kopiert!";
    setTimeout(() => { btn.textContent = orig; }, 2000);
  }

  /* ==========================================================================
     PAGINIERUNG ÜBER DIE ECHTEN SEITEN-LINKS [2], [3], [4]... [9]
     ========================================================================== */
  async function handleDirectPaginationLinks() {
    const loadBtn = document.getElementById("amz-inv-load-btn");
    const statusEl = document.getElementById("amz-inv-status");

    if (isLoadingBackground) {
      isLoadingBackground = false;
      loadBtn.textContent = "⏹ Gestoppt";
      return;
    }

    paginationDiagnostics.length = 0;

    // Wir holen alle echten nummerierten Seiten-Links (z. B. 2, 3, 4, 5, 6, 7, 8, 9)
    const pageLinks = Array.from(document.querySelectorAll(".a-pagination li:not(.a-selected) a"))
      .map(a => ({
        num: parseInt((a.textContent || "").trim(), 10),
        href: a.getAttribute("href")
      }))
      .filter(x => !isNaN(x.num) && x.href)
      .sort((a, b) => a.num - b.num);

    if (pageLinks.length === 0) {
      statusEl.textContent = "ℹ️ Keine weiteren Seiten auf dieser Ansicht vorhanden.";
      return;
    }

    isLoadingBackground = true;
    loadBtn.textContent = "⏹ Stop";
    loadBtn.style.background = "#ffebee";
    loadBtn.style.borderColor = "#ef5350";

    for (let i = 0; i < pageLinks.length; i++) {
      if (!isLoadingBackground) break;

      const p = pageLinks[i];
      const fullUrl = p.href.startsWith("http") ? p.href : window.location.origin + p.href;

      statusEl.textContent = `⏳ Lade Seite ${p.num} von ${pageLinks[pageLinks.length - 1].num} (${ordersMap.size} Bestellungen bisher)...`;

      try {
        const response = await requestHtml(fullUrl);
        const html = response.text || "";
        const doc = new DOMParser().parseFromString(html, "text/html");

        const result = extractOrdersFromDoc(doc, false);

        paginationDiagnostics.push({
          page: p.num,
          url: fullUrl,
          method: response.via,
          httpStatus: response.status,
          containersFound: result.cardsFound,
          extractedIdsCount: result.extractedIds.length,
          newOrdersAdded: result.newlyAddedCount,
          totalOrdersNow: ordersMap.size
        });

        renderTable();
        applyFilter();

        await sleep(1400);
      } catch (err) {
        paginationDiagnostics.push({
          page: p.num,
          url: fullUrl,
          error: err.message
        });
        statusEl.textContent = `⚠️ Fehler bei Seite ${p.num}: ${err.message}`;
        break;
      }
    }

    isLoadingBackground = false;
    loadBtn.textContent = "🔄 Alle Seiten nachladen";
    loadBtn.style.background = "#f0f2f5";
    loadBtn.style.borderColor = "#d1d5db";
    statusEl.textContent = `🎉 Fertig! ${ordersMap.size} Bestellungen in der Tabelle.`;
    applyFilter();
  }

  function renderTable() {
    const tbody = document.getElementById("amz-inv-tbody");
    if (!tbody) return;

    tbody.innerHTML = "";
    const sorted = Array.from(ordersMap.values()).sort((a, b) => b.date.localeCompare(a.date));

    sorted.forEach((info) => {
      const tr = document.createElement("tr");
      tr.className = "amz-table-row";
      tr.dataset.oid = info.id;
      tr.style.cssText = "border-bottom: 1px solid #f0f0f0;";

      tr.onclick = (e) => {
        if (e.target.tagName !== "INPUT" && info.cardElement) {
          info.cardElement.scrollIntoView({ behavior: "smooth", block: "center" });
          info.cardElement.style.outline = "2px solid #ff9900";
          setTimeout(() => (info.cardElement.style.outline = "none"), 2000);
        }
      };

      const dDisplay = info.date.length === 8 ? `${info.date.slice(6, 8)}.${info.date.slice(4, 6)}.${info.date.slice(0, 4)}` : info.date;

      const priceStyle = info.price === "Storniert" ? "color:#c62828;font-weight:600;" : "color:#0f1111;font-weight:600;";

      tr.innerHTML = `
        <td style="padding:4px;text-align:center;">
          <input type="checkbox" class="amz-table-cb" data-oid="${info.id}" ${selectedOrders.has(info.id) ? "checked" : ""} style="cursor:pointer;">
        </td>
        <td style="padding:4px;white-space:nowrap;color:#64748b;">${dDisplay}</td>
        <td style="padding:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:210px;" title="${info.title}">
          ${info.shortName}
        </td>
        <td style="padding:4px;text-align:right;white-space:nowrap;${priceStyle}">${info.price}</td>
      `;

      tr.querySelector(".amz-table-cb").onchange = (e) => {
        if (e.target.checked) selectedOrders.add(info.id);
        else selectedOrders.delete(info.id);
        syncMainPageCheckboxes();
        updateCounterAndButton();
      };

      tbody.appendChild(tr);
    });

    updateCounterAndButton();
  }

  function applyFilter() {
    const q = (document.getElementById("amz-inv-search")?.value || "").toLowerCase().trim();
    let visibleCount = 0;

    document.querySelectorAll(".amz-table-row").forEach((tr) => {
      const oid = tr.dataset.oid;
      const info = ordersMap.get(oid);
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

    updateCounterAndButton(visibleCount);
  }

  function syncMainPageCheckboxes() {
    document.querySelectorAll(".amz-card-cb").forEach((cb) => {
      cb.checked = selectedOrders.has(cb.dataset.oid);
    });
  }

  function syncTableCheckboxes() {
    document.querySelectorAll(".amz-table-cb").forEach((cb) => {
      cb.checked = selectedOrders.has(cb.dataset.oid);
    });
  }

  function updateCounterAndButton(visibleCount) {
    const currentVisible = visibleCount !== undefined ? visibleCount : document.querySelectorAll(".amz-table-row:not([style*='display: none'])").length;

    const badge = document.getElementById("amz-inv-counter-badge");
    if (badge) {
      badge.textContent = `Ausgewählt: ${selectedOrders.size} von ${currentVisible}`;
    }

    const dlBtn = document.getElementById("amz-inv-dl-btn");
    if (dlBtn) {
      dlBtn.textContent = `📥 Ausgewählte PDFs laden (${selectedOrders.size})`;
      dlBtn.disabled = selectedOrders.size === 0;
      dlBtn.style.opacity = selectedOrders.size === 0 ? "0.6" : "1";
    }
  }

  /* ==========================================================================
     TEST-DOWNLOAD (#1)
     ========================================================================== */
  async function runSingleTestDownload() {
    if (ordersMap.size === 0) return;
    const firstOrder = Array.from(ordersMap.values())[0];
    const statusEl = document.getElementById("amz-inv-status");

    statusEl.innerHTML = `🧪 Test-Download für <b>${firstOrder.id}</b>...`;
    await downloadAmazonOrder(firstOrder);
    statusEl.innerHTML = `✅ Test-PDF heruntergeladen: <b>${firstOrder.shortName}.pdf</b>`;
  }

  /* ==========================================================================
     BATCH-DOWNLOAD
     ========================================================================== */
  async function startDownloadBatch() {
    const ids = Array.from(selectedOrders);
    if (ids.length === 0) return;

    const statusEl = document.getElementById("amz-inv-status");
    const dlBtn = document.getElementById("amz-inv-dl-btn");
    const progressWrap = document.getElementById("amz-inv-progress-wrap");
    const progressFill = document.getElementById("amz-inv-progress-fill");
    const progressText = document.getElementById("amz-inv-progress-text");

    dlBtn.disabled = true;

    if (progressWrap) {
      progressWrap.style.display = "block";
      progressFill.style.width = "0%";
      progressFill.style.background = "linear-gradient(90deg, #ff9900, #ffb84d)";
      progressText.textContent = `0 / ${ids.length} (0%)`;
    }

    for (let i = 0; i < ids.length; i++) {
      const info = ordersMap.get(ids[i]);
      if (!info) continue;

      const currentPct = Math.round((i / ids.length) * 100);
      if (progressFill) progressFill.style.width = `${currentPct}%`;
      if (progressText) progressText.textContent = `${i} / ${ids.length} (${currentPct}%)`;

      statusEl.textContent = `[${i + 1}/${ids.length}] Lade PDF: ${info.shortName} ...`;

      await downloadAmazonOrder(info);
      await sleep(1800);

      const donePct = Math.round(((i + 1) / ids.length) * 100);
      if (progressFill) progressFill.style.width = `${donePct}%`;
      if (progressText) progressText.textContent = `${i + 1} / ${ids.length} (${donePct}%)`;
    }

    if (progressFill) progressFill.style.background = "#2e7d32";
    statusEl.textContent = `✅ Fertig! Gespeichert in: Downloads/invoices/amazon/`;
    dlBtn.disabled = false;
  }

  async function downloadAmazonOrder(info) {
    if (!info.popoverUrl) return;

    const fullPopoverUrl = info.popoverUrl.startsWith("http") ? info.popoverUrl : window.location.origin + info.popoverUrl;

    try {
      const res = await requestHtml(fullPopoverUrl);
      if (!res.ok) return;

      const html = res.text;
      const doc = new DOMParser().parseFromString(html, "text/html");

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

      if (!downloadUrl) return;

      const ext = downloadUrl.includes("print.html") ? "html" : "pdf";
      const filename = `${info.date}-${info.id}-${info.shortName}.${ext}`;

      if (typeof GM_download === "function") {
        await new Promise((resolve) => {
          GM_download({
            url: downloadUrl,
            name: `invoices/amazon/${filename}`,
            saveAs: false,
            onload: () => resolve(true),
            onerror: () => resolve(false)
          });
        });
      }
    } catch (e) {
      console.warn("Fehler beim Download:", e);
    }
  }

  /* ==========================================================================
     START
     ========================================================================== */
  createDashboard();
  collectOrders();
  setInterval(() => {
    createDashboard();
    collectOrders();
  }, 1500);
})();
