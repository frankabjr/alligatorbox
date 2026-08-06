'use strict';

// ── State ────────────────────────────────────────────────────────────────────

let selectedFile = null;
let uploadToken = null; // held so we can cancel on error

// ── DOM refs ─────────────────────────────────────────────────────────────────

const dropZone       = document.getElementById('drop-zone');
const fileInput      = document.getElementById('file-input');
const fileInfo       = document.getElementById('file-info');
const fileName       = document.getElementById('file-name');
const fileSize       = document.getElementById('file-size');
const clearFile      = document.getElementById('clear-file');
const passwordField  = document.getElementById('password');
const refreshPass    = document.getElementById('refresh-pass');
const togglePass     = document.getElementById('toggle-pass');
const expireDaysEl   = document.getElementById('expire-days');
const expireDlEl     = document.getElementById('expire-downloads');
const uploadBtn      = document.getElementById('upload-btn');

const uploadState    = document.getElementById('upload-state');
const progressState  = document.getElementById('progress-state');
const successState   = document.getElementById('success-state');

const progressBar    = document.getElementById('progress-bar');
const progressLabel  = document.getElementById('progress-label');

const shareUrl       = document.getElementById('share-url');
const sharePass      = document.getElementById('share-pass');
const copyUrl        = document.getElementById('copy-url');
const copyPass       = document.getElementById('copy-pass');
const copyBoth       = document.getElementById('copy-both');
const shareOneclick  = document.getElementById('share-oneclick');
const copyOneclick   = document.getElementById('copy-oneclick');
const resetBtn       = document.getElementById('reset-btn');

// ── Init ─────────────────────────────────────────────────────────────────────

passwordField.value = generatePassphrase(5);

// ── Drag & drop ──────────────────────────────────────────────────────────────

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) setFile(file);
});
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) setFile(fileInput.files[0]);
});

function setFile(file) {
  selectedFile = file;
  fileName.textContent = file.name;
  fileSize.textContent = formatSize(file.size);
  fileInfo.classList.remove('hidden');
  dropZone.querySelector('.drop-prompt').classList.add('hidden');
  uploadBtn.disabled = false;
}

clearFile.addEventListener('click', (e) => {
  e.stopPropagation();
  selectedFile = null;
  fileInput.value = '';
  fileInfo.classList.add('hidden');
  dropZone.querySelector('.drop-prompt').classList.remove('hidden');
  uploadBtn.disabled = true;
});

// ── Password controls ────────────────────────────────────────────────────────

refreshPass.addEventListener('click', () => {
  passwordField.value = generatePassphrase(5);
  passwordField.type = 'text';
});

togglePass.addEventListener('click', () => {
  passwordField.type = passwordField.type === 'password' ? 'text' : 'password';
  togglePass.textContent = passwordField.type === 'password' ? '👁' : '🙈';
});

// ── Upload ───────────────────────────────────────────────────────────────────

uploadBtn.addEventListener('click', startUpload);

async function startUpload() {
  if (!selectedFile) return;

  const password = passwordField.value.trim();
  if (!password) {
    alert('Please enter or generate a password.');
    return;
  }

  const expireDays = parseInt(expireDaysEl.value, 10) || 0;
  const expireDownloads = parseInt(expireDlEl.value, 10) || 0;

  showState(progressState);
  setProgress(0, 'Deriving encryption key…');

  try {
    const salt   = crypto.getRandomValues(new Uint8Array(SALT_SIZE));
    const baseIV = crypto.getRandomValues(new Uint8Array(BASE_IV_SIZE));
    const key    = await deriveKey(password, salt);

    setProgress(2, 'Encrypting filename…');
    const encName  = await encryptText(key, baseIV, selectedFile.name);
    const extra    = buildExtra(salt, baseIV);
    const encSize  = computeEncryptedSize(selectedFile.size);

    // Create file record
    const newResp = await fetch('/api/file/new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: encName,
        hash: encName, // reuse encrypted name as identifier
        size: selectedFile.size,
        encryptedSize: encSize,
        extra,
        expireDays,
        expireDownloads,
      }),
    });
    if (!newResp.ok) throw new Error('Server error creating file record');
    const { token } = await newResp.json();
    uploadToken = token;

    // Upload chunks
    const numChunks = Math.max(1, Math.ceil(selectedFile.size / CHUNK_SIZE));
    for (let i = 0; i < numChunks; i++) {
      const pct = Math.round(5 + (i / numChunks) * 90);
      setProgress(pct, `Encrypting & uploading chunk ${i + 1} of ${numChunks}…`);

      const start = i * CHUNK_SIZE;
      const slice = selectedFile.slice(start, start + CHUNK_SIZE);
      const plain = await slice.arrayBuffer();
      const enc   = await encryptChunk(key, baseIV, i, plain);

      const resp = await fetch(`/api/file/chunk?token=${token}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: enc,
      });
      if (!resp.ok) throw new Error('Failed to upload chunk ' + (i + 1));
    }

    setProgress(97, 'Finalizing…');
    const finResp = await fetch(`/api/file/finish?token=${token}`, { method: 'POST' });
    if (!finResp.ok) throw new Error('Failed to finalize upload');
    const { token: dlToken } = await finResp.json();
    uploadToken = null;

    setProgress(100, 'Done!');

    // Show success
    const url = `${location.origin}/${dlToken}`;
    shareUrl.value = url;
    sharePass.value = password;
    shareOneclick.value = `${url}#${encodeURIComponent(password)}`;
    setTimeout(() => showState(successState), 400);

  } catch (err) {
    if (uploadToken) {
      fetch(`/api/file/cancel?token=${uploadToken}`, { method: 'POST' }).catch(() => {});
      uploadToken = null;
    }
    alert('Upload failed: ' + err.message);
    showState(uploadState);
  }
}

// ── Copy helpers ──────────────────────────────────────────────────────────────

copyUrl.addEventListener('click', () => copyToClipboard(shareUrl.value, copyUrl));
copyPass.addEventListener('click', () => copyToClipboard(sharePass.value, copyPass));
copyBoth.addEventListener('click', () => {
  const text = `Link: ${shareUrl.value}\nPassword: ${sharePass.value}`;
  copyToClipboard(text, copyBoth);
});
copyOneclick.addEventListener('click', () => copyToClipboard(shareOneclick.value, copyOneclick));

// Copy text to clipboard — falls back to selecting input text when running over plain HTTP.
function copyToClipboard(text, btn) {
  const orig = btn.textContent;
  function done() {
    btn.textContent = 'Copied!';
    setTimeout(() => (btn.textContent = orig), 1500);
    }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(fallbackCopy);
    } else {
    fallbackCopy();
    }

  function fallbackCopy() {
    const el = document.getElementById('share-url');
    if (el) {
      el.value = text;
      el.select();
      document.execCommand('copy');
      } else {
      alert('Copy this: ' + text);
      }
    }
}

resetBtn.addEventListener('click', () => {
  selectedFile = null;
  fileInput.value = '';
  fileInfo.classList.add('hidden');
  dropZone.querySelector('.drop-prompt').classList.remove('hidden');
  uploadBtn.disabled = true;
  passwordField.value = generatePassphrase(5);
  showState(uploadState);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function showState(el) {
  [uploadState, progressState, successState].forEach(s => s.classList.add('hidden'));
  el.classList.remove('hidden');
}

function setProgress(pct, label) {
  progressBar.style.width = pct + '%';
  progressLabel.textContent = label;
}
