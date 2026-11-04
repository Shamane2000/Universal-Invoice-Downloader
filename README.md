# Universal Invoice Downloader (Tampermonkey Userscripts)

> Automated batch downloader and dashboard for official VAT receipts & invoices across multiple e-commerce platforms.

---

## 🛒 Supported Platforms

| Platform | Script | Status | Features |
| :--- | :--- | :---: | :--- |
| **AliExpress** | [`aliexpress/AliExpress-Invoice-Downloader.user.js`](aliexpress/AliExpress-Invoice-Downloader.user.js) | ✅ Stable (v5.0) | Multi-language (EN/DE), live search, multi-year auto-loader, progress bar, folder routing |
| **Amazon** | [`amazon/Amazon-Invoice-Downloader.user.js`](amazon/Amazon-Invoice-Downloader.user.js) | 🧪 In Progress (v0.4.8) | Auto-pagination, VAT PDF extraction, clean compact view, cancellation handling |

---

## 🚀 Installation

1. Install the [Tampermonkey](https://www.tampermonkey.net/) extension for your browser (Chrome, Firefox, Edge).
2. Choose your platform above and install the corresponding `.user.js` script.
3. Open your order history:
   - **AliExpress:** `https://www.aliexpress.com/p/order/index.html`
   - **Amazon:** `https://www.amazon.de/your-orders/orders`

---

## 📂 Project Structure

```
Universal-Invoice-Downloader/
├── aliexpress/
│   └── AliExpress-Invoice-Downloader.user.js   # Production v5.0
├── amazon/
│   └── Amazon-Invoice-Downloader.user.js       # Development v0.4.8
├── LICENSE                                     # GPL-3.0 License
└── README.md
```

---

## 🔒 Privacy & Local Execution
All scripts run **100% locally** within your browser via Tampermonkey. No credentials, tokens, addresses, or order data are ever transmitted to any external server or third party.

---

## 📜 License
GPL-3.0 License.

