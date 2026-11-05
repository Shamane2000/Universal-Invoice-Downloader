# Universal Invoice Downloader (Tampermonkey Userscripts)

> Automatisierter Stapel-Download und Dashboard für offizielle PDF/PNG-Rechnungen & Belege über mehrere E-Commerce-Plattformen mit nativer ZIP-Archivierung.

---

## 🛒 Unterstützte Plattformen

| Plattform | Script | Status | Highlights |
| :--- | :--- | :---: | :--- |
| **Amazon** | [`dist/Amazon-Invoice-Downloader.user.js`](dist/Amazon-Invoice-Downloader.user.js) | ✅ v1.2 Modular | SIEGE CSD Entschlüsselung, exakte Seiten-Berechnung, Spaltensortierung, Quickinfo-Hover, ZIP-Download |
| **AliExpress** | [`dist/AliExpress-Invoice-Downloader.user.js`](dist/AliExpress-Invoice-Downloader.user.js) | ✅ v2.0 Modular | Canvas/tax-ui Belegextraktion, Auto-Loader, Spaltensortierung, Quickinfo-Hover, ZIP-Download |
| **Universal (All-in-One)** | [`dist/Universal-Invoice-Downloader.user.js`](dist/Universal-Invoice-Downloader.user.js) | ✅ v2.0 Modular | Ein einziges Userscript für Amazon & AliExpress mit automatischer Shop-Erkennung |

---

## 🌟 Key Features

1. **📦 Native In-Memory ZIP-Archivierung (Keine 80 Browser-Abfragen mehr!)**:
   - Packt alle ausgewählten Rechnungen und Belege direkt im Browser-Speicher in ein einziges sauberes `.zip`-Archiv (z. B. `Amazon_Rechnungen_2025.zip` oder `AliExpress_Rechnungen_2025.zip`).
   - Verhindert das lästige Aufpoppen dutzender Download-Dialoge in Google Chrome vollständig.
   - Benötigt **keine** externen CDN-Bibliotheken oder unsichere `@require`-Skripte (100% natives Vanilla JS mit CRC-32 & UTF-8 Header-Support).

2. **⚡ Amazon SIEGE CSD Bypass**:
   - Umgeht Amazons clientseitige JavaScript-Verschlüsselung (`SiegeClientSideDecryption`) bei Hintergrundabfragen über `disableCsd=no-js`, sodass Titel, Preise und Rechnungs-Links aller Seiten vollständig geladen werden.

3. **🎯 Deterministische Paginierung**:
   - Liest die exakte Gesamtbestellanzahl (z. B. "85 Bestellungen") aus und generiert den vollständigen Abfragebereich ($0, 10, \dots, 80$). Kein Übersehen von Seiten durch `...`-Auslassungspunkte in der Amazon-Navigation.

4. **✨ Interaktives Dashboard**:
   - **Klickbare Spaltensortierung**: Beliebige Sortierung nach *Datum*, *Artikelname*, *Stückzahl* oder *Betrag* mit Richtungspfeilen (▲ / ▼).
   - **Quickinfo-Vorschau**: Zeigt beim Überfahren mit der Maus Bild, vollständigen Artikelnamen, Bestellnummer, Stückzahl und Status an.
   - **Fehlklickschutz**: Zeilenklicks scrollen auf der Seite zum Artikel; externe Tabs öffnen sich nur bei gezieltem Klick auf den Artikel-Link.
   - **Live-Filter**: Sofortige Filterung nach Suchbegriffen und Checkbox `☑️ Nur gültige` zum Ausblenden stornierter/erstatteter Bestellungen.
   - **Kompaktansicht**: Reduziert Bestellkarten auf der Originalseite auf platzsparende Zeilen.

---

## 🚀 Installation & Verwendung

1. Installiere die [Tampermonkey](https://www.tampermonkey.net/) Erweiterung in deinem Browser (Chrome, Firefox, Edge).
2. Installiere entweder das All-in-One Userscript oder das plattformspezifische Script:
   - **Universal (Empfohlen):** [`dist/Universal-Invoice-Downloader.user.js`](dist/Universal-Invoice-Downloader.user.js)
   - **Amazon Standalone:** [`dist/Amazon-Invoice-Downloader.user.js`](dist/Amazon-Invoice-Downloader.user.js)
   - **AliExpress Standalone:** [`dist/AliExpress-Invoice-Downloader.user.js`](dist/AliExpress-Invoice-Downloader.user.js)
3. Öffne deine Bestellübersicht:
   - **Amazon:** `https://www.amazon.de/your-orders/orders`
   - **AliExpress:** `https://www.aliexpress.com/p/order/index.html`
4. Klicke auf `🔄 Alle nachladen`, wähle die gewünschten Bestellungen aus und klicke auf `📦 Als ZIP-Archiv laden`.

---

## 📂 Projektstruktur & Modularität

```
Universal-Invoice-Downloader/
├── src/
│   ├── core/
│   │   ├── utils.js            # Bereinigung, Datums- & Preis-Parser, HTTP-Helper
│   │   ├── downloader.js       # SimpleZip (Zero-Dependency), Batch-Queue, Multi-Stage Fetch
│   │   └── ui.js               # UniversalDashboard, Sortierlogik, Quickinfo, Fortschrittsbalken
│   └── adapters/
│       ├── amazon.js           # Amazon-Adapter (data-csa-c-slot-id, SIEGE-Bypass, Paginierung)
│       └── aliexpress.js       # AliExpress-Adapter (tax-ui Canvas, PostMessage-Worker)
├── dist/
│   ├── Amazon-Invoice-Downloader.user.js       # Kompiliertes Amazon Userscript
│   ├── AliExpress-Invoice-Downloader.user.js   # Kompiliertes AliExpress Userscript
│   └── Universal-Invoice-Downloader.user.js    # Universelles All-in-One Userscript
├── build.py                    # Build-Pipeline (bündelt ES-Module zu Tampermonkey-Skripten)
├── LICENSE                     # GPL-3.0 License
└── README.md
```

---

## 🔒 Datenschutz & Lokale Ausführung
Alle Skripte arbeiten **100% lokal** in deinem eigenen Browser. Es werden zu keinem Zeitpunkt Zugangsdaten, Passwörter, private Adressdaten oder Bestellinhalte an externe Server übermittelt.

---

## 📜 Lizenz
GPL-3.0 License.
