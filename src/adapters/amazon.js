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
      let dateMatch = cleanCardText.match(/(\d{1,2}\.\s*[a-zA-ZäöüÄÖÜ]{3,12}\.?\s*\d{4})/);
      if (!dateMatch && card.parentElement) {
        dateMatch = cleanString(card.parentElement.textContent || "").match(/(\d{1,2}\.\s*[a-zA-ZäöüÄÖÜ]{3,12}\.?\s*\d{4})/);
      }
      const rawDate = dateMatch ? dateMatch[1] : "";
      const isoDate = parseGermanDate(rawDate);

      // Bild / Thumbnail für Quickinfo-Hover
      let imageUrl = "";
      const img = card.querySelector("img[src*='images-amazon'], img[src*='media-amazon'], img[src*='ssl-images-amazon'], img[data-a-hires]");
      if (img) {
        imageUrl = img.getAttribute("src") || img.getAttribute("data-a-hires") || "";
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
        const productLinks = Array.from(card.querySelectorAll("a[href*='/dp/'], a[href*='/gp/product/'], a[href*='asin_title'], a.a-link-normal"));
        for (const a of productLinks) {
          const txt = cleanString(a.textContent || a.innerText || "");
          if (txt.length > 5 && !/nochmals|locker|verfolgen|rueckgabe|bewert|widerruf|frage|bestelldetails|rechnung|problem/i.test(txt)) {
            title = txt;
            break;
          }
        }
      }

      if (!title || /frank|hertzschuch|adresse|locker/i.test(title)) {
        title = `Amazon_Bestellung_${orderId.slice(-7)}`;
      }

      const shortName = sanitizeTitle(title);

      // Preis ermitteln
      let price = "";
      if (isCancelled) {
        price = "Storniert";
      } else {
        const pMatch = cleanCardText.match(/(€\s*[\d.,]+|EUR\s*[\d.,]+|[\d.,]+\s*€)/i);
        if (pMatch) price = pMatch[1].trim();
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
