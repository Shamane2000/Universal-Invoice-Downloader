#!/usr/bin/env python3
"""
Simple Build Script for Universal Invoice Downloader
Bundles src/core and src/adapters into standalone Userscripts in dist/
"""
import os
import re

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "src")
DIST = os.path.join(ROOT, "dist")

os.makedirs(DIST, exist_ok=True)

def strip_imports_exports(code):
    # Remove 'import ... from ...;'
    code = re.sub(r'import\s+.*?;', '', code)
    # Replace 'export const/function/class' with 'const/function/class'
    code = re.sub(r'export\s+(const|let|var|function|class)\s+', r'\1 ', code)
    # Remove 'export default ...;'
    code = re.sub(r'export\s+default\s+.*?;', '', code)
    return code

def read_file(rel_path):
    with open(os.path.join(SRC, rel_path), "r", encoding="utf-8") as f:
        return f.read()

def build_amazon():
    utils = strip_imports_exports(read_file("core/utils.js"))
    downloader = strip_imports_exports(read_file("core/downloader.js"))
    ui = strip_imports_exports(read_file("core/ui.js"))
    amazon = strip_imports_exports(read_file("adapters/amazon.js"))

    header = """// ==UserScript==
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
"""

    bootstrap = """
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
"""

    output = f"{header}\n{utils}\n{downloader}\n{ui}\n{amazon}\n{bootstrap}"
    out_path = os.path.join(DIST, "Amazon-Invoice-Downloader.user.js")
    with open(out_path, "w", encoding="utf-8") as out:
        out.write(output)
    print(f"Built {out_path} ({len(output)} bytes)")

if __name__ == "__main__":
    build_amazon()

