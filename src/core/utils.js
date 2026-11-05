/**
 * Core Utilities: Sanitization, Parsing, Network Helpers
 */

export const MONTH_MAP_DE = {
  januar: "01", jan: "01", februar: "02", feb: "02",
  märz: "03", mär: "03", mar: "03", april: "04", apr: "04",
  mai: "05", may: "05", juni: "06", jun: "06",
  juli: "07", jul: "07", august: "08", aug: "08",
  september: "09", sep: "09", oktober: "10", okt: "10", oct: "10",
  november: "11", nov: "11", dezember: "12", dez: "12", dec: "12"
};

export const MONTH_MAP_EN = {
  january: "01", jan: "01", february: "02", feb: "02",
  march: "03", mar: "03", april: "04", apr: "04",
  may: "05", june: "06", jun: "06",
  july: "07", jul: "07", august: "08", aug: "08",
  september: "09", sep: "09", october: "10", oct: "10",
  november: "11", nov: "11", december: "12", dec: "12"
};

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function cleanString(str) {
  if (!str) return "";
  return str.replace(/[\u200B-\u200D\uFEFF\u200E\u200F]/g, "").replace(/\s+/g, " ").trim();
}

export function sanitizeTitle(raw, maxLen = 32) {
  if (!raw) return "artikel";
  let s = cleanString(raw).toLowerCase();
  s = s.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
  s = s.replace(/\b(original|neu|new|pro|plus|stk|stueck|pcs|pack|set)\b/gi, " ");
  s = s.replace(/[^a-z0-9]+/g, "_");
  s = s.replace(/^_+|_+$/g, "");
  return s.slice(0, maxLen).replace(/_+$/, "") || "artikel";
}

export function parseGermanDate(text) {
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

export function requestHtml(url, options = {}) {
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
