#!/usr/bin/env python3
"""
Build Script for Universal Invoice Downloader
Bundles src/core and src/adapters into standalone and universal Userscripts in dist/
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

def get_common_modules():
    utils = strip_imports_exports(read_file("core/utils.js"))
    downloader = strip_imports_exports(read_file("core/downloader.js"))
    ui = strip_imports_exports(read_file("core/ui.js"))
    return utils, downloader, ui

def generate_bootstrap(shop_name, shop_icon, adapter_class_name):
    return f"""
  /* ==========================================================================
     APP INITIALISIERUNG ({shop_name})
     ========================================================================== */
  const isWorker = window.location.pathname.includes("/order/detail.html") || window.location.pathname.includes("/tax-ui/");
  const downloader = new BatchDownloader(1800);
  let adapter = null;

  const ui = new UniversalDashboard({{
    shopName: "{shop_name}",
    shopIcon: "{shop_icon}",
    callbacks: {{
      onLoadMore: () => {{
        if (adapter) adapter.loadMorePages();
      }},
      onDownloadBatch: async (selectedIds) => {{
        if (selectedIds.length === 0 || !adapter) return;
        const items = selectedIds.map(id => ui.ordersMap.get(id)).filter(Boolean);

        const dlBtn = document.getElementById("uid-dl-btn");
        if (dlBtn) dlBtn.disabled = true;

        await downloader.run(
          items,
          (order) => adapter.resolveDownloadInfo(order),
          {{
            onStart: (total) => {{
              ui.setProgress(0, total, `0 / ${{total}} (0%)`);
            }},
            onProgress: (cur, total, item) => {{
              ui.setProgress(cur, total);
              ui.setStatus(`[${{cur}}/${{total}}] Lade: ${{item.shortName}} ...`);
            }},
            onComplete: () => {{
              ui.setStatus(`✅ Fertig! Gespeichert im Download-Ordner.`);
              if (dlBtn) dlBtn.disabled = false;
              if (adapter.closeWorker) adapter.closeWorker();
            }}
          }}
        );
      }},
      onDownloadZip: async (selectedIds) => {{
        if (selectedIds.length === 0 || !adapter) return;
        const items = selectedIds.map(id => ui.ordersMap.get(id)).filter(Boolean);

        const zipBtn = document.getElementById("uid-zip-btn");
        if (zipBtn) zipBtn.disabled = true;

        const currentYear = new URLSearchParams(window.location.search).get("orderFilter")?.replace("year-", "") || new Date().getFullYear();
        const zipFilename = `{shop_name}_Rechnungen_${{currentYear}}.zip`;

        await downloader.runBatchZip(
          items,
          (order) => adapter.resolveDownloadInfo(order),
          zipFilename,
          {{
            onStart: (total) => {{
              ui.setProgress(0, total, `0 / ${{total}} (0%)`);
            }},
            onProgress: (cur, total, item) => {{
              ui.setProgress(cur, total);
              ui.setStatus(`[${{cur}}/${{total}}] Packe in ZIP: ${{item.shortName}} ...`);
            }},
            onComplete: (cancelled, packedCount) => {{
              ui.setStatus(`✅ Fertig! ${{packedCount}} Belege in <b>${{zipFilename}}</b> gepackt.`);
              if (zipBtn) zipBtn.disabled = false;
              if (adapter.closeWorker) adapter.closeWorker();
            }}
          }}
        );
      }},
      onDownloadTest: async () => {{
        if (ui.ordersMap.size === 0 || !adapter) return;
        const testOrder = Array.from(ui.selectedOrders.values()).map(id => ui.ordersMap.get(id)).find(o => o && o.price !== "Storniert") ||
                          Array.from(ui.ordersMap.values()).find(o => o && o.price !== "Storniert") ||
                          Array.from(ui.ordersMap.values())[0];
        ui.setStatus(`🧪 Test-Download für <b>${{testOrder.id}}</b> (${{testOrder.shortName}})...`);
        try {{
          const info = await adapter.resolveDownloadInfo(testOrder);
          if (info && info.url) {{
            await downloader.downloadFile(info.url, info.filename, info.subfolder);
            ui.setStatus(`✅ Test-Beleg heruntergeladen: <b>${{info.filename}}</b>`);
          }} else {{
            ui.setStatus(`⚠️ Belegs-URL für ${{testOrder.id}} nicht verfügbar.`);
          }}
        }} catch (err) {{
          ui.setStatus(`❌ Fehler: ${{err.message}}`);
        }}
      }}
    }}
  }});

  if (!isWorker) {{
    ui.mount();
  }}

  adapter = new {adapter_class_name}(ui);
  adapter.init();
}})();
"""

def build_amazon():
    utils, downloader, ui = get_common_modules()
    amazon = strip_imports_exports(read_file("adapters/amazon.js"))

    header = """// ==UserScript==
// @name         Amazon Pro Invoice Downloader (v1.2 Modular Edition)
// @namespace    https://github.com/Shamane2000/Universal-Invoice-Downloader
// @version      1.2.0
// @description  Automatisierter PDF-Rechnungs-Download & ZIP-Archivierung für Amazon mit data-csa-c-slot-id Extraktion, Spaltensortierung, Quickinfo-Hover & Kompakt-Modus
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
    bootstrap = generate_bootstrap("Amazon", "📦", "AmazonAdapter")
    output = f"{header}\n{utils}\n{downloader}\n{ui}\n{amazon}\n{bootstrap}"
    out_path = os.path.join(DIST, "Amazon-Invoice-Downloader.user.js")
    with open(out_path, "w", encoding="utf-8") as out:
        out.write(output)
    print(f"Built {out_path} ({len(output)} bytes)")

def build_aliexpress():
    utils, downloader, ui = get_common_modules()
    ali = strip_imports_exports(read_file("adapters/aliexpress.js"))

    header = """// ==UserScript==
// @name         AliExpress Pro Invoice Downloader (v2.0 Modular Edition)
// @namespace    https://github.com/Shamane2000/Universal-Invoice-Downloader
// @version      2.0.0
// @description  Automatisierter Beleg- & Rechnungs-Download & ZIP-Archivierung für AliExpress mit Spaltensortierung, Quickinfo-Hover und Kompakt-Modus
// @match        https://*.aliexpress.com/p/order/index.html*
// @match        https://*.aliexpress.com/p/order/detail.html*
// @match        https://*.aliexpress.us/p/order/index.html*
// @match        https://*.aliexpress.us/p/order/detail.html*
// @match        https://*.aliexpress.ru/p/order/index.html*
// @match        https://*.aliexpress.ru/p/order/detail.html*
// @match        https://*.aliexpress.com/tax-ui/*
// @match        https://*.aliexpress.us/tax-ui/*
// @match        https://*.aliexpress.ru/tax-ui/*
// @grant        GM_download
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @author       Shamane2000
// @license      GPL-3.0
// ==/UserScript==

(function () {
  "use strict";
"""
    bootstrap = generate_bootstrap("AliExpress", "🛍️", "AliExpressAdapter")
    output = f"{header}\n{utils}\n{downloader}\n{ui}\n{ali}\n{bootstrap}"
    out_path = os.path.join(DIST, "AliExpress-Invoice-Downloader.user.js")
    with open(out_path, "w", encoding="utf-8") as out:
        out.write(output)
    print(f"Built {out_path} ({len(output)} bytes)")

def build_universal():
    utils, downloader, ui = get_common_modules()
    amazon = strip_imports_exports(read_file("adapters/amazon.js"))
    ali = strip_imports_exports(read_file("adapters/aliexpress.js"))

    header = """// ==UserScript==
// @name         Universal Pro Invoice Downloader (Amazon & AliExpress)
// @namespace    https://github.com/Shamane2000/Universal-Invoice-Downloader
// @version      2.0.0
// @description  Automatisierter PDF/PNG Rechnungs-Download & ZIP-Archivierung für Amazon und AliExpress mit Sortierung, Quickinfo-Vorschau und Kompakt-Modus.
// @match        https://*.amazon.de/*order*
// @match        https://*.amazon.com/*order*
// @match        https://*.aliexpress.com/p/order/index.html*
// @match        https://*.aliexpress.com/p/order/detail.html*
// @match        https://*.aliexpress.us/p/order/index.html*
// @match        https://*.aliexpress.us/p/order/detail.html*
// @match        https://*.aliexpress.ru/p/order/index.html*
// @match        https://*.aliexpress.ru/p/order/detail.html*
// @match        https://*.aliexpress.com/tax-ui/*
// @match        https://*.aliexpress.us/tax-ui/*
// @match        https://*.aliexpress.ru/tax-ui/*
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
     UNIVERSAL INITIALISIERUNG (Auto-Erkennung Amazon / AliExpress)
     ========================================================================== */
  const isWorker = window.location.pathname.includes("/order/detail.html") || window.location.pathname.includes("/tax-ui/");
  const downloader = new BatchDownloader(1800);

  const registry = [
    { name: "Amazon", icon: "📦", cls: AmazonAdapter },
    { name: "AliExpress", icon: "🛍️", cls: AliExpressAdapter }
  ];

  let selectedAdapterCls = null;
  let activeName = "Universal";
  let activeIcon = "📄";

  for (const item of registry) {
    const dummy = new item.cls(null);
    if (dummy.matches()) {
      selectedAdapterCls = item.cls;
      activeName = item.name;
      activeIcon = item.icon;
      break;
    }
  }

  if (!selectedAdapterCls) {
    return;
  }

  let adapter = null;
  const ui = new UniversalDashboard({
    shopName: activeName,
    shopIcon: activeIcon,
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
              ui.setStatus(`[${cur}/${total}] Lade: ${item.shortName} ...`);
            },
            onComplete: () => {
              ui.setStatus(`✅ Fertig! Gespeichert im Download-Ordner.`);
              if (dlBtn) dlBtn.disabled = false;
              if (adapter.closeWorker) adapter.closeWorker();
            }
          }
        );
      },
      onDownloadZip: async (selectedIds) => {
        if (selectedIds.length === 0 || !adapter) return;
        const items = selectedIds.map(id => ui.ordersMap.get(id)).filter(Boolean);

        const zipBtn = document.getElementById("uid-zip-btn");
        if (zipBtn) zipBtn.disabled = true;

        const currentYear = new URLSearchParams(window.location.search).get("orderFilter")?.replace("year-", "") || new Date().getFullYear();
        const zipFilename = `${activeName}_Rechnungen_${currentYear}.zip`;

        await downloader.runBatchZip(
          items,
          (order) => adapter.resolveDownloadInfo(order),
          zipFilename,
          {
            onStart: (total) => {
              ui.setProgress(0, total, `0 / ${total} (0%)`);
            },
            onProgress: (cur, total, item) => {
              ui.setProgress(cur, total);
              ui.setStatus(`[${cur}/${total}] Packe in ZIP: ${item.shortName} ...`);
            },
            onComplete: (cancelled, packedCount) => {
              ui.setStatus(`✅ Fertig! ${packedCount} Belege in <b>${zipFilename}</b> gepackt.`);
              if (zipBtn) zipBtn.disabled = false;
              if (adapter.closeWorker) adapter.closeWorker();
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
        try {
          const info = await adapter.resolveDownloadInfo(testOrder);
          if (info && info.url) {
            await downloader.downloadFile(info.url, info.filename, info.subfolder);
            ui.setStatus(`✅ Test-Beleg heruntergeladen: <b>${info.filename}</b>`);
          } else {
            ui.setStatus(`⚠️ Belegs-URL für ${testOrder.id} nicht verfügbar.`);
          }
        } catch (err) {
          ui.setStatus(`❌ Fehler: ${err.message}`);
        }
      }
    }
  });

  if (!isWorker) {
    ui.mount();
  }

  adapter = new selectedAdapterCls(ui);
  adapter.init();
})();
"""
    output = f"{header}\n{utils}\n{downloader}\n{ui}\n{amazon}\n{ali}\n{bootstrap}"
    out_path = os.path.join(DIST, "Universal-Invoice-Downloader.user.js")
    with open(out_path, "w", encoding="utf-8") as out:
        out.write(output)
    print(f"Built {out_path} ({len(output)} bytes)")

if __name__ == "__main__":
    build_amazon()
    build_aliexpress()
    build_universal()
