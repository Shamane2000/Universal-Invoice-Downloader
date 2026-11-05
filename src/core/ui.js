/**
 * Core UI: Universal Floating Dashboard, Table, Live Search, Hover-Quickinfo & Progress Bar
 */

import { cleanString, parseNumericPrice } from "./utils.js";

export class UniversalDashboard {
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

        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <div style="display:flex; gap:4px; flex:1;">
            <button id="uid-select-all" style="flex:1; padding:5px; background:#fff; border:1px solid #d1d5db; border-radius:4px; font-size:11px; cursor:pointer;">☑️ Alle gefilterten</button>
            <button id="uid-select-none" style="flex:1; padding:5px; background:#fff; border:1px solid #d1d5db; border-radius:4px; font-size:11px; cursor:pointer;">◻️ Auswahl leeren</button>
          </div>
          <label style="margin-left:8px; font-size:11px; color:#475569; display:flex; align-items:center; gap:4px; cursor:pointer; user-select:none;" title="Stornierte und erstattete Bestellungen ohne Rechnung ausblenden">
            <input type="checkbox" id="uid-hide-cancelled-cb" checked style="cursor:pointer;">
            <span>Nur gültige</span>
          </label>
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

        <div style="display:flex; flex-direction:column; gap:6px;">
          <button id="uid-zip-btn" style="width:100%; padding:9px; background:linear-gradient(to bottom, #f7dfa5, #f0c14b); border:1px solid #a88734; border-radius:6px; font-weight:700; font-size:13px; color:#111; cursor:pointer; box-shadow:0 1px 2px rgba(0,0,0,0.1); display:flex; align-items:center; justify-content:center; gap:6px;">
            📦 Als ZIP-Archiv laden (0)
          </button>
          <div style="display:flex; gap:6px;">
            <button id="uid-dl-btn" style="flex:2; padding:7px 8px; background:#f0f2f5; border:1px solid #d1d5db; border-radius:6px; font-weight:600; font-size:11px; color:#111; cursor:pointer;" title="Lädt jede PDF als einzelne Datei herunter">
              📥 PDFs einzeln laden (0)
            </button>
            <button id="uid-test-btn" style="flex:1; padding:7px 8px; background:#f0f2f5; border:1px solid #d1d5db; border-radius:6px; font-weight:600; font-size:11px; color:#111; cursor:pointer;" title="Lädt 1 Rechnung zur Probe">
              🧪 Test (#1)
            </button>
          </div>
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

    const zipBtn = this.panel.querySelector("#uid-zip-btn");
    if (zipBtn) {
      zipBtn.onclick = () => {
        if (this.callbacks.onDownloadZip) this.callbacks.onDownloadZip(Array.from(this.selectedOrders));
      };
    }

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

    const hideCb = this.panel.querySelector("#uid-hide-cancelled-cb");
    if (hideCb) {
      hideCb.onchange = () => this.applyFilter();
    }
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
          <a href="${info.detailsUrl || ('https://www.amazon.de/gp/your-account/order-details?orderID=' + info.id)}" target="_blank" style="text-decoration:none;color:#0f1111;font-weight:500;" onclick="event.stopPropagation();" title="Klick öffnet Bestelldetails in neuem Tab">
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
    const hideCancelled = document.getElementById("uid-hide-cancelled-cb")?.checked ?? true;
    let visibleCount = 0;

    this.panel.querySelectorAll(".uid-table-row").forEach((tr) => {
      const oid = tr.dataset.oid;
      const info = this.ordersMap.get(oid);
      if (!info) return;

      const isInvalid = info.isCancelled || info.isRefunded || info.price === "Storniert" || /storniert|cancelled|erstattet|refunded/i.test(info.price);
      if (hideCancelled && isInvalid) {
        tr.style.display = "none";
        return;
      }

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

    const zipBtn = this.panel.querySelector("#uid-zip-btn");
    if (zipBtn) {
      zipBtn.innerHTML = `📦 Als ZIP-Archiv laden (${this.selectedOrders.size})`;
      zipBtn.disabled = this.selectedOrders.size === 0;
      zipBtn.style.opacity = this.selectedOrders.size === 0 ? "0.6" : "1";
    }

    const dlBtn = this.panel.querySelector("#uid-dl-btn");
    if (dlBtn) {
      dlBtn.textContent = `📥 PDFs einzeln laden (${this.selectedOrders.size})`;
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

    if (current < 0 || total === 0 || (current === 0 && total === undefined)) {
      if (wrap) wrap.style.display = "none";
      return;
    }

    if (wrap) wrap.style.display = "block";
    let pct = 0;
    if (total !== undefined && total > 0) {
      pct = Math.round((current / total) * 100);
      if (pText) pText.textContent = text || `${current} / ${total} (${pct}%)`;
    } else {
      pct = Math.min(100, Math.max(0, Math.round(current)));
      if (pText) pText.textContent = text || `${pct}%`;
    }
    if (fill) fill.style.width = `${pct}%`;
  }
}
