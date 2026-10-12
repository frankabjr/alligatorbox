# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Bitbox is a zero-knowledge encrypted file sharing web application. All encryption/decryption is performed client-side in the browser using AES-256-GCM (Web Crypto API). The Go backend stores only ciphertext and never sees plaintext files or passwords.

## Commands

```bash
# Run the server (Go 1.22+ required)
export PATH=$PATH:/usr/local/opt/go/bin
go run .

# Build binary
go build -o bitbox .

# The server listens on :8080
# Upload page: http://localhost:8080/
# Download page: http://localhost:8080/{token}
```

## Architecture

### Backend (`main.go` + `handlers/handlers.go`)

- Pure Go standard library, no external dependencies.
- `main.go`: HTTP mux setup. Routes `/api/*` to handlers; `/assets/*` to `static/`; all other paths serve `static/download.html` (download page).
- `handlers/handlers.go`: Six API endpoints:
  - `POST /api/file/new` – validates request, generates a random 32-hex-char upload token, writes `data/uploads/{token}/meta.json`.
  - `PUT /api/file/chunk?token=…` – appends raw binary body to `data/uploads/{token}/data.bin`. Max 2 MB per request.
  - `POST /api/file/finish?token=…` – generates a download token, renames `uploads/{token}/` → `files/{dlToken}/`.
  - `POST /api/file/cancel?token=…` – removes the upload directory.
  - `GET /api/file/meta/{token}` – returns `FileMeta` JSON; checks expiry.
  - `GET /api/file/chunk/{token}/{start}/{length}` – serves a byte range from `data/files/{token}/data.bin`. Increments download counter on `start==0`.
- File storage layout: `data/uploads/{uploadToken}/{meta.json,data.bin}` and `data/files/{dlToken}/{meta.json,data.bin}`.
- Token validation uses `regexp.MustCompile(`^[0-9a-f]{32}$`)` to prevent path traversal.
- Expiry is enforced two ways: **lazily** on every metadata/chunk request, and **proactively** by a background sweep. `main.go` calls `h.StartCleanupSweep(time.Hour)` (runs once at startup, then hourly), which invokes `Handler.SweepExpired` — it removes any file older than the 30-day hard cap (the `maxRetention` constant) or already expired via `expired()` (a shorter time limit, or a download-count limit reached). This guarantees files that expire but are never accessed actually get deleted instead of lingering on disk forever.
- Retention is capped at **30 days** server-side regardless of the user's choice; the upload UI's "Delete after N days" is limited to 1–30 (default 10), and "0" means "use the 30-day default." "Delete after N downloads" defaults to 5.

### Frontend (`static/`)

- No framework, no build step. Plain HTML + CSS + vanilla JS using Web Crypto API.
- `assets/js/crypto-utils.js` – shared constants and helpers:
  - `CHUNK_SIZE = 1 MB`, `CHUNK_OVERHEAD = 28` (12-byte IV + 16-byte GCM tag).
  - `deriveKey(password, salt)` → PBKDF2-SHA256, 100k iterations, AES-256-GCM key.
  - `encryptChunk(key, baseIV, chunkIndex, plaintext)` → `IV || ciphertext || tag`.
  - `decryptChunk(key, chunkIndex, data)` → plaintext ArrayBuffer.
  - `chunkIV(baseIV, index)` → copies baseIV and XORs last 4 bytes with `index` (use `0xFFFFFFFF` for filename).
  - `buildExtra(salt, baseIV)` / `parseExtra(b64)` – serialise the 28-byte `extra` field (16-byte salt + 12-byte baseIV stored in file metadata).
  - `computeEncryptedSize(plainSize)` – computes total stored bytes.
- `assets/js/diceware.js` – generates a 5-word passphrase from a 512-word list using `crypto.getRandomValues`.
- `assets/js/upload.js` – handles the upload UI and calls the API. Reads the file in 1 MB slices, encrypts each, PUTs to the server.
- `assets/js/download.js` – handles the download UI. Extracts token from `location.pathname`, decrypts filename first (to verify password), then streams and decrypts chunks. Supports auto-filling password from URL fragment (`/{token}#password`).
- `index.html` – upload page (three states: upload / progress / success).
- `download.html` – download page (four states: info+password / progress / done / error).
- `assets/css/style.css` – custom dark-theme CSS; no external framework.

### Crypto scheme

| Step | Detail |
|------|--------|
| Key derivation | PBKDF2(password, salt[16], 100 000 iterations, SHA-256) → AES-256-GCM key |
| Stored `extra` | base64(salt[16] \|\| baseIV[12]) – 28 bytes → ~40 chars |
| Chunk N IV | baseIV with bytes 8–11 XOR'd with N (big-endian uint32) |
| Filename IV | baseIV with bytes 8–11 XOR'd with 0xFFFFFFFF |
| Stored format | Per chunk: IV(12) \|\| ciphertext \|\| GCM-tag(16) – concatenated in `data.bin` |
| Download range | `GET /api/file/chunk/{token}/{byteStart}/{byteLen}` – client computes offsets using `ENCRYPTED_CHUNK_SIZE = CHUNK_SIZE + 28` |
