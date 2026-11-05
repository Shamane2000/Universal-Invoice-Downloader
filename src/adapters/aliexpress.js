/**
 * AliExpress Shop Adapter
 * Handles order extraction, auto-paging, detail page receipt trigger,
 * tax-ui canvas/dataURL interception, and packaging for both single download & ZIP bundling.
 */

import { cleanString, parseGermanDate, sanitizeTitle, sleep } from "../core/utils.js";

export const AUTO_FLAG = "ali-inv-dl";
export const RECEIPT_TEXTS = /^(receipt|beleg|rechnung|recibo|reçu|fatura|factura|invoice|download receipt)$/i;

export class AliExpressAdapter {
  constructor(ui) {
    this.name = "AliExpress";
    this.icon = "🛍️";
    this.ui = ui;
    this.workerWindow = null;
    this.pendingResolvers = new Map();
  }

  matches() {
    return window.location.hostname.includes("aliexpress.");
  }

  injectStyles() {
    if (document.getElementById("uid-ali-styles")) return;
    const style = document.createElement("style");
    style.id = "uid-ali-styles";
    style.textContent = `
      body.uid-compact-mode .order-item,
      body.uid-compact-mode [class*='order-item--root'],
      body.uid-compact-mode [class*='order-item-wrap'] {
        margin-bottom: 3px !important;
        padding: 4px 10px !important;
        border: 1px solid #e2e8f0 !important;
        box-shadow: none !important;
        height: 38px !important;
        overflow: hidden !important;
        display: flex !important;
        align-items: center !important;
      }
      body.uid-compact-mode .order-item-header {
        margin: 0 10px 0 0 !important;
        padding: 0 !important;
        border: none !important;
        font-size: 11px !important;
        display: flex !important;
        gap: 8px !important;
        flex-shrink: 0 !important;
      }
      body.uid-compact-mode .order-item-content {
        display: flex !important;
        align-items: center !important;
        gap: 10px !important;
        padding: 0 !important;
        margin: 0 !important;
        flex: 1 !important;
      }
      body.uid-compact-mode img {
        width: 26px !important;
        height: 26px !important;
        object-fit: cover !important;
      }
    `;
    document.head.appendChild(style);
  }

  init() {
    const pathname = window.location.pathname;

    // 1. DETAIL PAGE HANDLER
    if (pathname.includes("/order/detail.html")) {
      this.initDetailPage();
      return;
    }

    // 2. TAX-UI IFRAME HANDLER
    if (pathname.includes("/tax-ui/")) {
      this.initTaxUiIframe();
      return;
    }

    // 3. OVERVIEW PAGE
    this.injectStyles();
    this.setupMessageListener();
    this.collectOrders(document, true);
    setInterval(() => this.collectOrders(document, true), 2000);
  }

  setupMessageListener() {
    window.addEventListener("message", (event) => {
      if (event.data && event.data.action === "ali_receipt_dataurl") {
        const { orderId, dataUrl, filename } = event.data;
        if (orderId && this.pendingResolvers.has(orderId)) {
          const resolver = this.pendingResolvers.get(orderId);
          this.pendingResolvers.delete(orderId);
          resolver({ dataUrl, filename });
        } else if (this.pendingResolvers.size > 0) {
          // Fallback wenn orderId nicht explizit gematcht ist
          const firstKey = this.pendingResolvers.keys().next().value;
          const resolver = this.pendingResolvers.get(firstKey);
          this.pendingResolvers.delete(firstKey);
          resolver({ dataUrl, filename });
        }
      }
    });
  }

  async initDetailPage() {
    if (!window.location.hash.includes(AUTO_FLAG)) return;

    const urlParams = new URLSearchParams(window.location.search);
    const orderId = urlParams.get("orderId") || "";
    const invDate = urlParams.get("inv_date") || "2026";
    const invName = urlParams.get("inv_name") || "item";
    const targetFilename = `${invDate}-${invName}.png`;

    // Empfange das generierte Bild aus dem Tax-UI Iframe
    window.addEventListener("message", (event) => {
      if (event.data && event.data.action === "ali_receipt_dataurl") {
        const { dataUrl, filename } = event.data;
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage({
            action: "ali_receipt_dataurl",
            orderId: orderId,
            dataUrl: dataUrl,
            filename: filename || targetFilename
          }, "*");
        }
      }
    });

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
      console.warn("[AliExpressAdapter] Receipt button not found.");
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
            iframe.contentWindow.postMessage({
              action: "ali_receipt_auto_dl",
              orderId: orderId,
              filename: targetFilename
            }, "*");
            return;
          }
        } catch (e) {}
      }
    }
  }

  initTaxUiIframe() {
    window.addEventListener("message", async (event) => {
      if (event.data && event.data.action === "ali_receipt_auto_dl") {
        const filename = event.data.filename || "receipt.png";
        const orderId = event.data.orderId || "";
        const dlBtn = document.querySelector("#download-receipt") || document.querySelector("button[class*='download']");
        if (dlBtn) {
          const originalAppend = document.body.appendChild.bind(document.body);
          let intercepted = false;
          document.body.appendChild = function (elem) {
            if (elem && elem.tagName === "A" && elem.href && elem.href.startsWith("data:")) {
              intercepted = true;
              window.parent.postMessage({
                action: "ali_receipt_dataurl",
                orderId: orderId,
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
                  orderId: orderId,
                  dataUrl: canvas.toDataURL("image/png"),
                  filename: filename
                }, "*");
              }
            }
          }, 3500);
        }
      }
    });
  }

  collectOrders(doc = document, isLivePage = true) {
    const cards = doc.querySelectorAll(".order-item, [class*='order-item--root'], [class*='order-item-wrap']");
    const extracted = [];

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

      const orderDate = parseGermanDate(card.innerText);

      let bestTitle = "";
      const contentArea = card.querySelector(".order-item-content") || card;
      const candidates = [];

      contentArea.querySelectorAll("a, span, p, div").forEach((el) => {
        if (el.children.length === 0) {
          const t = cleanString(el.innerText || el.textContent || "");
          if (
            t.length >= 8 &&
            !/^(\$|€|chf|gbp|rub|\d+[.,]\d{2})/i.test(t) &&
            !/^(kopieren|copy|bestellung|order|details?|tracking|reorder|track order|view details)/i.test(t) &&
            !t.toLowerCase().includes("store")
          ) {
            candidates.push(t);
          }
        }
      });

      candidates.sort((a, b) => b.length - a.length);
      bestTitle = candidates.length > 0 ? candidates[0] : `Ali_Order_${orderId.slice(-6)}`;
      const shortName = sanitizeTitle(bestTitle);

      let price = "-";
      const pMatch = card.innerText.match(/(€\s*[\d.,]+|CHF\s*[\d.,]+|\$\s*[\d.,]+|£\s*[\d.,]+|[\d.,]+\s*€)/);
      if (pMatch) price = pMatch[1].trim();

      // Thumbnail Image
      let imageUrl = "";
      const imgEl = card.querySelector("img");
      if (imgEl && imgEl.src && !imgEl.src.includes("data:image/svg")) {
        imageUrl = imgEl.src;
      }

      // Quantity
      let quantity = 1;
      const qMatch = card.innerText.match(/(?:x|×|menge:|qty:)\s*(\d+)/i);
      if (qMatch) quantity = parseInt(qMatch[1], 10) || 1;

      const isCancelled = /storniert|cancelled|closed|beendet/i.test(card.innerText);
      const isRefunded = /refunded|erstattet/i.test(card.innerText);

      extracted.push({
        id: orderId,
        date: orderDate,
        rawDate: orderDate.length === 8 ? `${orderDate.slice(6, 8)}.${orderDate.slice(4, 6)}.${orderDate.slice(0, 4)}` : orderDate,
        title: bestTitle,
        shortName: shortName,
        quantity: quantity,
        price: isCancelled ? "Storniert" : price,
        imageUrl: imageUrl,
        detailsUrl: `https://${window.location.host}/p/order/detail.html?orderId=${orderId}`,
        cardElement: isLivePage ? card : null,
        isCancelled: isCancelled,
        isRefunded: isRefunded
      });
    });

    if (extracted.length > 0 && this.ui) {
      this.ui.addOrders(extracted);
    }
  }

  async loadMorePages() {
    const btns = document.querySelectorAll("button, div[role='button'], a");
    let moreBtn = null;
    for (const b of btns) {
      const txt = (b.textContent || "").trim().toLowerCase();
      if (
        txt.includes("weitere bestellungen") ||
        txt.includes("view more orders") ||
        txt.includes("mehr anzeigen") ||
        txt.includes("show more") ||
        txt.includes("load more")
      ) {
        moreBtn = b;
        break;
      }
    }

    if (!moreBtn) {
      if (this.ui) this.ui.setStatus("Alle AliExpress-Bestellungen geladen!");
      return;
    }

    moreBtn.scrollIntoView({ behavior: "smooth", block: "center" });
    moreBtn.click();
    await sleep(2000);
    this.collectOrders(document, true);
  }

  async resolveDownloadInfo(order) {
    if (!this.workerWindow || this.workerWindow.closed) {
      this.workerWindow = window.open("about:blank", "ali_worker_window", "width=850,height=700");
    }

    if (!this.workerWindow) {
      throw new Error("Bitte Pop-ups im Browser für AliExpress erlauben!");
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingResolvers.delete(order.id);
        reject(new Error("Timeout beim Laden des AliExpress Belegs"));
      }, 18000);

      this.pendingResolvers.set(order.id, (result) => {
        clearTimeout(timeout);
        resolve({
          url: result.dataUrl,
          filename: result.filename || `${order.date}-${order.shortName}.png`,
          subfolder: `aliexpress/${order.date.slice(0, 4)}`
        });
      });

      const url = `${window.location.origin}/p/order/detail.html?orderId=${order.id}&inv_date=${order.date}&inv_name=${encodeURIComponent(order.shortName)}#${AUTO_FLAG}`;
      this.workerWindow.location.href = url;
    });
  }

  closeWorker() {
    if (this.workerWindow && !this.workerWindow.closed) {
      try {
        this.workerWindow.close();
      } catch (e) {}
      this.workerWindow = null;
    }
  }
}
