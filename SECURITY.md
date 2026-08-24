# Security Model

## Overview

AlligatorBox is a **zero-knowledge** encrypted file-sharing application. All encryption and decryption happens client-side in the browser using the Web Crypto API. The server never sees plaintext files or passwords.

## What the Server Never Sees

- **Plaintext files** — only ciphertext bytes are stored on disk.
- **Encryption passwords** — passwords are used exclusively in the browser to derive encryption keys via PBKDF2.
- **Decryption keys** — keys derived from the password never leave the browser.
- **File contents** — even if an attacker gains filesystem access to the `data/` directory, they cannot recover the original files without the passwords.

## What the Server Does Store

- **Encrypted ciphertext** in `data/files/{token}/data.bin`.
- **Metadata** including the file name (encrypted with AES-256-GCM, then base64-encoded), size, encrypted size, expiration settings, download count, salt (16 bytes), and base IV (12 bytes) in `meta.json`.
- The salt and base IV are required for decryption but are not secrets — they must be stored alongside the ciphertext.

## Cryptographic Details

### Key Derivation

| Parameter | Value |
|-----------|-------|
| Algorithm | PBKDF2 |
| Hash | SHA-256 |
| Iterations | 100,000 |
| Salt | 16 bytes (generated with `crypto/rand`) |
| Output key length | 32 bytes (AES-256) |

### Encryption

| Parameter | Value |
|-----------|-------|
| Algorithm | AES-256-GCM |
| Mode | Web Crypto API (native implementation) |
| Chunk size | 1 MB plaintext per chunk |
| IV scheme | Base IV with last 4 bytes XOR'd with a big-endian uint32 counter |

### Stored File Format

Each chunk is stored as `IV(12 bytes) || ciphertext || GCM tag(16 bytes)`, concatenated sequentially in `data.bin`.

## Threat Model

### Server Can Observe

- File sizes (ciphertext size differs slightly from plaintext due to GCM tags).
- Number of download attempts (download counter is server-side).
- When files are uploaded and downloaded.
- Expiration metadata (time limits, download limits).

### Server Cannot Observe

- Plaintext file contents.
- Passwords or derived keys.
- Which files a user downloads (beyond the download counter — there's no per-user tracking).

## TLS / Self-Signed Certificates

AlligatorBox includes a built-in `-tls` flag that generates a self-signed certificate for local HTTPS development:

```bash
go run . -tls          # HTTPS on localhost with auto-generated cert
```

The cert/key pair lives in `data/cert.pem` and `data/key.pem`. On restarts, existing files are reused so the browser's "not trusted" warning only appears once per device.

### When HTTPS Is Required

- **localhost** — plain HTTP (`http://localhost:8080`) works because browsers treat `localhost` as a secure origin. The Web Crypto API (`crypto.subtle`) will function without TLS.
- **LAN access** — accessing from another device via your local IP (e.g., `http://192.168.1.5:8080`) is **not** a secure context, so the Web Crypto API will fail. Use `go run . -tls -b 0.0.0.0` to serve HTTPS on all interfaces.
- **Public / remote servers** — TLS should always be enabled for production use. Self-signed certs are suitable for LAN or personal deployment; for public hosting, pair the server with a reverse proxy (e.g., Caddy) that handles real certificate issuance.

### Security Recommendations

1. **Use strong passwords.** The diceware passphrase generator produces 5-word random phrases (approximately 63 bits of entropy from a 512-word list). For more security, use custom passwords with high entropy.

2. **Share the link and password separately.** Do not send both via the same channel.

3. **Set short expiration.** Use day-based or download-count expiry to limit the window of exposure for time-sensitive files.

4. **Use TLS in production.** The `-tls` flag provides self-signed certs suitable for local development and LAN access. For public servers, use a reverse proxy (e.g., Caddy) with a valid certificate. Never expose unencrypted HTTP to any network beyond your local loopback.

5. **Be aware of metadata.** File names are **encrypted with AES-256-GCM** (same key as the file body, IV counter `0xFFFFFFFF`) and then **base64-encoded** so the ciphertext fits in the JSON `name` field. Base64 is only an encoding — the confidentiality comes from AES-256-GCM — so the contents are not readable on disk; however, the encoded length still reveals the plaintext byte length. Avoid names whose length alone reveals sensitive information.

## Known Considerations

- **No rate limiting** on the API — the server accepts uploads from anyone with an `/api/file/new` call. If exposing to the internet behind a reverse proxy, add rate limiting at the proxy layer.
- **Lazy expiry enforcement** — file expiration is checked on metadata and chunk requests, not via a background goroutine. A file may remain on disk briefly after expiring if no one accesses it.
- **No authentication** — the server has no user accounts or access controls. Anyone with a download token can retrieve the file. Use network-level firewalls or reverse-proxy auth if needed.
