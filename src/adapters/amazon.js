/**
 * Amazon Shop Adapter
 * Uses verified data-csa-c-slot-id attribute for 100% order ID precision,
 * thumbnail extraction for Quickinfo-Hover, and robust multi-page pagination.
 */

import { cleanString, parseGermanDate, sanitizeTitle, requestHtml, sleep } from "../core/utils.js";

export class AmazonAdapter {
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
