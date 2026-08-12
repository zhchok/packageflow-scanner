# PackageFlow Scanner

Static Telegram Mini App for button-triggered 1D/2D barcode and tracking-text scanning.

- Runs barcode recognition locally on the user's device.
- Scans once on tap or continuously while the scan button is held.
- Falls back to local OCR when a barcode or QR code cannot be decoded.
- Sends only the decoded tracking number to PackageFlow Bot.
- Does not upload, store, or transmit camera frames.
- Uses the native `BarcodeDetector` API when available and ZXing as a compatibility fallback.

The application contains no Telegram bot token, Google credentials, spreadsheet identifiers, or customer data.

Changes are prepared and checked in `develop`; GitHub Pages serves only the
reviewed `main` branch. GitHub Actions verifies CSP hardening, version and SRI
pinning, forbidden browser APIs, and accidental embedded credentials.
