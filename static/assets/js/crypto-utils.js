'use strict';

// Chunk size for streaming encryption
const CHUNK_SIZE = 1024 * 1024; // 1 MB plaintext per chunk
const CHUNK_OVERHEAD = 12 + 16; // AES-GCM IV (12) + auth tag (16)
const ENCRYPTED_CHUNK_SIZE = CHUNK_SIZE + CHUNK_OVERHEAD;
const SALT_SIZE = 16;
const BASE_IV_SIZE = 12;
const PBKDF2_ITERATIONS = 100000;

// Build the `extra` field: base64(salt[16] || baseIV[12])
function buildExtra(salt, baseIV) {
  const buf = new Uint8Array(SALT_SIZE + BASE_IV_SIZE);
  buf.set(salt, 0);
  buf.set(baseIV, SALT_SIZE);
  return bytesToBase64(buf);
}

// Parse the `extra` field back to { salt, baseIV }
function parseExtra(extraB64) {
  const buf = base64ToBytes(extraB64);
  return {
    salt: buf.slice(0, SALT_SIZE),
    baseIV: buf.slice(SALT_SIZE, SALT_SIZE + BASE_IV_SIZE),
  };
}

// Derive AES-256-GCM key from password + salt via PBKDF2-SHA-256
async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const raw = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    raw,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// Build per-chunk IV: copies baseIV and XORs last 4 bytes with chunk index.
// Use index 0xFFFFFFFF for filename (avoids collision with data chunks).
function chunkIV(baseIV, index) {
  const iv = new Uint8Array(12);
  iv.set(baseIV);
  const view = new DataView(iv.buffer);
  view.setUint32(8, view.getUint32(8, false) ^ (index >>> 0), false);
  return iv;
}

// Encrypt an ArrayBuffer → Uint8Array with IV prepended (IV || ciphertext || tag)
async function encryptChunk(key, baseIV, chunkIndex, plaintext) {
  const iv = chunkIV(baseIV, chunkIndex);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  const out = new Uint8Array(12 + ciphertext.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ciphertext), 12);
  return out;
}

// Decrypt a Uint8Array (IV || ciphertext || tag) → ArrayBuffer
async function decryptChunk(key, chunkIndex, data) {
  const iv = data.slice(0, 12);
  const ciphertext = data.slice(12);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
}

// Encrypt a UTF-8 string → base64 string (uses chunk index 0xFFFFFFFF)
async function encryptText(key, baseIV, text) {
  const enc = new TextEncoder();
  const encrypted = await encryptChunk(key, baseIV, 0xFFFFFFFF, enc.encode(text));
  return bytesToBase64(encrypted);
}

// Decrypt a base64 string → UTF-8 string
async function decryptText(key, baseIV, b64) {
  const data = base64ToBytes(b64);
  const plain = await decryptChunk(key, 0xFFFFFFFF, data);
  return new TextDecoder().decode(plain);
}

// Compute the total encrypted byte size given a plaintext size
function computeEncryptedSize(plainSize) {
  if (plainSize === 0) return CHUNK_OVERHEAD; // one empty chunk
  const numChunks = Math.ceil(plainSize / CHUNK_SIZE);
  return plainSize + numChunks * CHUNK_OVERHEAD;
}

// ── Base64 helpers ───────────────────────────────────────────────────────────

function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── Human-readable size ──────────────────────────────────────────────────────

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
