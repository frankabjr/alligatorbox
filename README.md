# AlligatorBox

**Zero-knowledge encrypted file sharing — your files are encrypted in the browser before they ever reach a server.**

[![CC0 1.0](https://img.shields.io/badge/License-CC0%201.0-lightgrey.svg)](LICENSE)
[![KooPIMI!](https://img.shields.io/badge/KooPIMI%21-F9EB19-black?labelColor=27272A&color=CDC543)](https://kopimi.com)

## Overview

AlligatorBox is a minimalist file-sharing web application built with Go and vanilla JavaScript. You upload a file, enter an encryption password (or let the app generate a random 5-word diceware passphrase), and the browser encrypts the entire file client-side using **AES-256-GCM** before sending ciphertext to the server.

The server **never sees your plaintext file or password**. It only stores encrypted blobs on disk and serves them back. When the recipient opens the share link, decryption happens entirely in their browser.

This means:
- No account needed — no usernames, passwords, emails.
- The server operator cannot read any uploaded file.
- Files can be configured to self-destruct after N days or N downloads.

## Quick Start

```bash
# Make sure Go 1.22+ is on your PATH
export PATH=$PATH:/usr/local/opt/go/bin

# Run the server
go run .

# Open in browser
open http://localhost:8080
```

The server listens on `http://127.0.0.1:8080` by default. Use `-b 0.0.0.0` to bind all interfaces and `-p 9000` to change the port.

## Building a Standalone Binary

```bash
go build -o alligatorbox .
./alligatorbox
```

The built binary is fully self-contained — it embeds the frontend assets (HTML/CSS/JS) and requires no additional files on disk.

## Usage

### Uploading a File

1. Navigate to `http://localhost:8080/`.
2. Drag & drop (or browse for) a file up to **10 GB**.
3. Enter an encryption password or click the refresh button (🔄) to generate a random 5-word diceware passphrase.
4. Optionally set expiration — delete after N days or N downloads.
5. Click **Encrypt & Upload**. The browser encrypts the file chunk by chunk and streams it to the server.
6. When finished, you get a **share link** and the **password**. Copy both and send them separately for best security.

A one-click sharing link embeds the password in the URL fragment (`#`). The recipient clicks it and the download starts automatically — the password fragment is stripped by the browser before sending any request to the server.

### Downloading a File

1. Open the share link in a browser (e.g., `http://example.com/abc123def456…`).
2. Enter the decryption password or let it auto-fill from the URL fragment.
3. Click **Decrypt & Download**. The file is fetched and decrypted chunk by chunk, then saved to your downloads folder.

### Server Options

| Flag | Default | Description |
|------|---------|-------------|
| `-p PORT` | `8080` | Port to listen on |
| `-b ADDR` | `127.0.0.1` | Interface address (use `0.0.0.0` for all interfaces) |
| `-tls` | `false` | Enable HTTPS with self-signed certificate |

```bash
go run . -p 9000 -b 0.0.0.0          # custom port and bind
go run . -tls                        # HTTPS on localhost (default port/key path)
go run . -tls -cert /path/cert.pem   # custom cert/key paths
```

**Why HTTPS is needed for LAN access:** The Web Crypto API (`crypto.subtle`) only works in a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts). Plain HTTP over `http://127.0.0.1` or `localhost` works out of the box — browsers treat these as secure origins. For access from another device on your network (`http://<lan-ip>:8080`), you'll need TLS: `go run . -tls -b 0.0.0.0` and accept the browser's self-signed certificate warning (one-time per device).

## Production Deployment with Caddy

The Go server binds to `127.0.0.1` by default and serves only HTTP. For public or LAN access you need a TLS-terminating reverse proxy — [Caddy](https://caddyserver.com/) is the recommended approach.

### Why Caddy?

Caddy obtains and renews **free Let's Encrypt certificates automatically**. No manual certbot commands, no cron jobs, no certificate expiry anxiety. It also handles HTTP-to-HTTPS redirects and GZIP compression out of the box.

### The DNS Requirement

Let's Encrypt (and any public CA) issues certificates for a **domain name**, not a bare IP address. You need:

1. A **registered domain** (e.g., `files.example.com`).
2. A **DNS "A" record** pointing to your server's public IP — the `A` record must resolve from anywhere on the internet, including Let's Encrypt's validation servers.

If you don't have a resolvable FQDN, Let's Encrypt cannot issue a certificate and Caddy will fall back to serving self-signed certs (or refuse to start). For LAN-only access without a public domain, use the `-tls` flag directly on the Go binary instead — see above for details.

### Step-by-Step

**1. Install Caddy.** Follow [caddyserver.com/download](https://caddyserver.com/download) for your platform (or use `brew install caddy`).

**2. Edit the Caddyfile.** Replace `files.example.com` with your actual domain:

```caddy
# Caddyfile
files.example.com {

	reverse_proxy 127.0.0.1:8080

	encode gzip
	request_body {
		max_size 5MB
	}
}
```

**3. Start the Go server.** Bind it to localhost only — Caddy handles all external traffic:

```bash
# From the binary root directory:
./alligatorbox-linux-amd64 -b 127.0.0.1 -p 8080
```

**4. Start Caddy:**

```bash
caddy start --config ./Caddyfile
# or run in foreground for testing:
caddy run --config ./Caddyfile
```

That's it. Caddy will immediately attempt a Let's Encrypt certificate, validate your domain, and serve HTTPS on port 443. The certificate auto-renews every ~90 days — Caddy handles the renewal silently in the background.

### systemd Service (Optional)

An example unit file is included as `alligatorbox.service`. Adjust the `ExecStart` path and enable it:

```bash
sudo cp alligatorbox.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now alligatorbox
```

### Firewall Configuration

Open port **443** (HTTPS) on your firewall. Port 80 (HTTP) is needed for Let's Encrypt's ACME HTTP-01 challenge during initial certificate issuance — Caddy binds it temporarily and releases it after validation completes. Once the cert is obtained, only 443 traffic is required.

```bash
# Example: UFW
sudo ufw allow 80/tcp   # for Let's Encrypt validation
sudo ufw allow 443/tcp  # HTTPS access
sudo ufw enable
```

## Architecture

### Backend — Go

The server is a single binary with **zero external dependencies** beyond the Go standard library.

**Routes:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/file/new` | Validate request, generate upload token, write metadata |
| `PUT` | `/api/file/chunk?token=…` | Append raw encrypted bytes to the file (max 2 MB/request) |
| `POST` | `/api/file/finish?token=…` | Mark upload complete, generate download token |
| `POST` | `/api/file/cancel?token=…` | Cancel an in-progress upload |
| `GET` | `/api/file/meta/{token}` | Return file metadata (`FileMeta` JSON); checks expiry |
| `GET` | `/api/file/chunk/{token}/{start}/{length}` | Serve a byte range from the encrypted file |

**Storage layout:**

```
data/
  uploads/{uploadToken}/
    meta.json       # File metadata (name, size, extra, expiry)
    data.bin        # Raw encrypted ciphertext
  files/{dlToken}/
    meta.json       # Same metadata after upload completes
    data.bin        # Encrypted file contents
```

The binary embeds the frontend using Go's `embed.FS`. During development it prefers an on-disk `static/` directory for live edits; the embedded copy is the fallback for standalone binaries.

### Frontend — Vanilla JS

No frameworks, no build step, no CDNs. Everything lives in `static/`:

| File | Purpose |
|------|---------|
| `index.html` | Upload page (upload → progress → success states) |
| `download.html` | Download page (info → progress → done / error states) |
| `assets/css/style.css` | Dark-theme custom CSS |
| `assets/js/crypto-utils.js` | Shared crypto: PBKDF2 key derivation, AES-256-GCM chunk encryption/decryption, IV construction |
| `assets/js/diceware.js` | 5-word passphrase generator from a 512-word list |
| `assets/js/upload.js` | Upload UI: reads files in 1 MB slices, encrypts each, streams to server via PUT |
| `assets/js/download.js` | Download UI: decrypts filename first (password verification), streams chunks, triggers browser download |

## Encryption Details

All crypto runs client-side via the **Web Crypto API** (AES-GCM mode). The server only handles ciphertext.

| Step | Detail |
|------|--------|
| Key derivation | PBKDF2(password, 16-byte salt, 100 000 iterations, SHA-256) → AES-256 key |
| Encryption | AES-256-GCM per chunk |
| Chunk size | 1 MB plaintext + overhead |
| Stored format (per chunk) | `IV(12 bytes) || ciphertext || GCM tag(16 bytes)` — concatenated in `data.bin` |
| IV scheme | Base IV with the last 4 bytes XOR'd with a big-endian uint32 counter. The filename uses counter `0xFFFFFFFF`. |
| Extra field | Base64-encoded `salt[16] || baseIV[12]` — stored in metadata so decryption can reconstruct keys |

See [SECURITY.md](SECURITY.md) for the threat model and security notes.

## API Reference

### Upload Flow

Three-step upload: **new → chunk (× N) → finish**

1. `POST /api/file/new` — body is a JSON `NewFileRequest`:
   ```json
    {
      "name": "photo.jpg",
      "hash": "",
      "size": 1048576,
      "encryptedSize": 1048700,
      "extra": "aGVsbG93b3JsZA==",
      "expireDays": 7,
      "expireDownloads": 3
    }
    ```
   Response: `{"token": "abcdef..."}` (32-hex-char upload token).

2. `PUT /api/file/chunk?token=…` — body is raw encrypted binary (≤ 2 MB per request). Stream chunks until the full file is uploaded.

3. `POST /api/file/finish?token=…` — moves the file from `data/uploads/` to `data/files/{dlToken}/`. Response: `{"token": "fedcba..."}` (download token).

### Download

4. `GET /api/file/meta/{token}` — returns metadata as JSON. Checks time and download-count expiry.
5. `GET /api/file/chunk/{token}/{start}/{length}` — serves encrypted bytes at the given offset and length. The client increments a 1 MB window with GCM overhead.

### Cancel

6. `POST /api/file/cancel?token=…` — deletes the upload directory and cancels an in-progress upload.

## Tech Stack

- **Language:** Go 1.22+ (backend), JavaScript ES6+ (frontend)
- **Crypto:** Web Crypto API (AES-256-GCM, PBKDF2)
- **Frontend:** Vanilla HTML/CSS/JS — no frameworks, no build tools
- **Backend:** Go standard library only (`net/http`, `crypto/rand`, `encoding/hex`, `regexp`)
- **Deployment:** Self-hosted binary; Caddyfile included as a reverse-proxy example

## File Structure

```
.
├── main.go                # HTTP mux, static serving, embedded assets
├── handlers/
│    └── handlers.go       # 6 API endpoints, file storage logic
├── static/
│    ├── index.html          # Upload page
│    ├── download.html       # Download page
│    └── assets/
│        ├── css/style.css   # Dark-theme styling
│        └── js/
│            ├── crypto-utils.js   # Shared encryption helpers
│            ├── diceware.js       # Passphrase generator
│            ├── upload.js         # Upload UI & API calls
│            └── download.js       # Download UI & decryption
├── data/                  # Runtime directory (created at startup)
│    ├── uploads/            # In-progress uploads
│    └── files/              # Completed encrypted files
├── Caddyfile              # Example reverse proxy config
├── alligatorbox.service     # Example systemd unit file
└── README.md
```

## License

This project is released under the [CC0 1.0 Universal license](https://creativecommons.org/publicdomain/zero/1.0/). You may freely use, modify, distribute, and create derivative works without restriction. See [LICENSE](LICENSE) for the full legal text.
