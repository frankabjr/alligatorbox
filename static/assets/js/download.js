'use strict';

// ── DOM refs ─────────────────────────────────────────────────────────────────

const infoState      = document.getElementById('info-state');
const downloadState  = document.getElementById('download-state');
const doneState      = document.getElementById('done-state');
const errorState     = document.getElementById('error-state');

const metaName       = document.getElementById('meta-name');
const metaSize       = document.getElementById('meta-size');
const metaExpiry     = document.getElementById('meta-expiry');

const passwordField  = document.getElementById('password');
const togglePass     = document.getElementById('toggle-pass');
const downloadBtn    = document.getElementById('download-btn');

const dlProgressBar  = document.getElementById('dl-progress-bar');
const dlProgressLbl  = document.getElementById('dl-progress-label');

const errorMsg       = document.getElementById('error-msg');

// ── Bootstrap ─────────────────────────────────────────────────────────────────

const token = location.pathname.replace(/^\//, '');

if (!token || !/^[0-9a-f]{32}$/.test(token)) {
  showError('Invalid or missing file token.');
} else {
  loadMeta();
}

// Auto-fill password from URL fragment (e.g. /{token}#mypassword)
if (location.hash) {
  passwordField.value = decodeURIComponent(location.hash.slice(1));
  // Clear hash so it doesn't linger in the address bar
  history.replaceState(null, '', location.pathname);
}

togglePass.addEventListener('click', () => {
  passwordField.type = passwordField.type === 'password' ? 'text' : 'password';
  togglePass.textContent = passwordField.type === 'password' ? '👁' : '🙈';
});

downloadBtn.addEventListener('click', startDownload);
passwordField.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startDownload();
});

// ── Metadata ──────────────────────────────────────────────────────────────────

let fileMeta = null;

async function loadMeta() {
  try {
    const resp = await fetch(`/api/file/meta/${token}`);
    if (!resp.ok) {
      showError('File not found. It may have expired or already been downloaded the maximum number of times.');
      return;
    }
    fileMeta = await resp.json();

    // Show size (plaintext)
    metaSize.textContent = formatSize(fileMeta.size);

    // Show expiry info
    const parts = [];
    if (fileMeta.expireDays > 0) {
      const exp = new Date((fileMeta.since + fileMeta.expireDays * 86400) * 1000);
      parts.push(`Expires ${exp.toLocaleDateString()}`);
    }
    if (fileMeta.expireDownloads > 0) {
      const left = fileMeta.expireDownloads - fileMeta.downloads;
      parts.push(`${left} download${left !== 1 ? 's' : ''} remaining`);
    }
    metaExpiry.textContent = parts.length ? parts.join(' · ') : 'No expiration';

    showState(infoState);

    // If password was pre-filled from the hash, start automatically
    if (passwordField.value) startDownload();

  } catch (err) {
    showError('Could not load file metadata: ' + err.message);
  }
}

// ── Download & decrypt ────────────────────────────────────────────────────────

async function startDownload() {
  const password = passwordField.value.trim();
  if (!password) {
    passwordField.focus();
    return;
  }

  showState(downloadState);
  setProgress(0, 'Deriving key…');

  try {
    const { salt, baseIV } = parseExtra(fileMeta.extra);
    const key = await deriveKey(password, salt);

    // Decrypt filename (verifies the password is correct)
    setProgress(3, 'Verifying password…');
    let filename;
    try {
      filename = await decryptText(key, baseIV, fileMeta.name);
    } catch {
      showState(infoState);
      passwordField.classList.add('shake');
      setTimeout(() => passwordField.classList.remove('shake'), 600);
      passwordField.select();
      alert('Incorrect password. Please try again.');
      return;
    }

    // Download chunks
    const plainSize = fileMeta.size;
    const numChunks = Math.max(1, Math.ceil(plainSize / CHUNK_SIZE));
    const chunks = [];

    for (let i = 0; i < numChunks; i++) {
      const pct = Math.round(5 + (i / numChunks) * 90);
      setProgress(pct, `Downloading chunk ${i + 1} of ${numChunks}…`);

      // Byte range within the stored binary:
      // All non-last chunks are exactly ENCRYPTED_CHUNK_SIZE bytes.
      const chunkStart  = i * ENCRYPTED_CHUNK_SIZE;
      const plainChunk  = Math.min(CHUNK_SIZE, plainSize - i * CHUNK_SIZE);
      const chunkLength = plainChunk + CHUNK_OVERHEAD;

      const resp = await fetch(`/api/file/chunk/${token}/${chunkStart}/${chunkLength}`);
      if (!resp.ok) throw new Error(`Failed to download chunk ${i + 1}`);

      const encData = new Uint8Array(await resp.arrayBuffer());

      setProgress(pct, `Decrypting chunk ${i + 1} of ${numChunks}…`);
      const plain = await decryptChunk(key, i, encData);
      chunks.push(new Uint8Array(plain));
    }

    setProgress(98, 'Assembling file…');

    // Assemble and trigger browser download
    const blob = new Blob(chunks);
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setProgress(100, 'Done!');
    document.getElementById('done-filename').textContent = filename;
    setTimeout(() => showState(doneState), 400);

  } catch (err) {
    showError('Download failed: ' + err.message);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function showState(el) {
  [infoState, downloadState, doneState, errorState].forEach(s => s.classList.add('hidden'));
  el.classList.remove('hidden');
}

function setProgress(pct, label) {
  dlProgressBar.style.width = pct + '%';
  dlProgressLbl.textContent = label;
}

function showError(msg) {
  errorMsg.textContent = msg;
  showState(errorState);
}
