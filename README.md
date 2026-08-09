# PackageFlow Scanner

Static Telegram Mini App for real-time 1D/2D barcode scanning.

- Runs barcode recognition locally on the user's device.
- Sends only the decoded tracking number to PackageFlow Bot.
- Does not upload, store, or transmit camera frames.
- Uses the native `BarcodeDetector` API when available and ZXing as a compatibility fallback.

The application contains no Telegram bot token, Google credentials, spreadsheet identifiers, or customer data.
