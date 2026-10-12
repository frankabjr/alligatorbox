package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"time"
)

var tokenRe = regexp.MustCompile(`^[0-9a-f]{32}$`)

// maxRetention is the hard server-side cap: every stored file is deleted no
// later than 30 days after upload, regardless of what the uploader chose.
// Files with a shorter user-set expiry (days or download count) are removed
// earlier by the same sweep.
const maxRetention = 30 * 24 * time.Hour

type Handler struct {
	dataDir string
}

func New(dataDir string) *Handler {
	return &Handler{dataDir: dataDir}
}

type NewFileRequest struct {
	Name            string `json:"name"`
	Hash            string `json:"hash"`
	Size            int64  `json:"size"`
	EncryptedSize   int64  `json:"encryptedSize"`
	Extra           string `json:"extra"`
	ExpireDays      int    `json:"expireDays"`
	ExpireDownloads int    `json:"expireDownloads"`
}

type FileMeta struct {
	Name            string `json:"name"`
	Hash            string `json:"hash"`
	Size            int64  `json:"size"`
	EncryptedSize   int64  `json:"encryptedSize"`
	Extra           string `json:"extra"`
	ExpireDays      int    `json:"expireDays"`
	ExpireDownloads int    `json:"expireDownloads"`
	Since           int64  `json:"since"`
	Downloads       int    `json:"downloads"`
}

func randomToken() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func (h *Handler) NewFile(w http.ResponseWriter, r *http.Request) {
	var req NewFileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if req.Size < 0 || req.Size > 10<<30 { // max 10GB
		http.Error(w, "invalid size", http.StatusBadRequest)
		return
	}

	token, err := randomToken()
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	dir := filepath.Join(h.dataDir, "uploads", token)
	if err := os.MkdirAll(dir, 0755); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	meta := FileMeta{
		Name:            req.Name,
		Hash:            req.Hash,
		Size:            req.Size,
		EncryptedSize:   req.EncryptedSize,
		Extra:           req.Extra,
		ExpireDays:      req.ExpireDays,
		ExpireDownloads: req.ExpireDownloads,
		Since:           time.Now().Unix(),
	}

	if err := writeMeta(dir, &meta); err != nil {
		os.RemoveAll(dir)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"token": token})
}

func (h *Handler) UploadChunk(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if !tokenRe.MatchString(token) {
		http.Error(w, "invalid token", http.StatusBadRequest)
		return
	}

	dir := filepath.Join(h.dataDir, "uploads", token)
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		http.Error(w, "upload not found", http.StatusNotFound)
		return
	}

	// Limit chunk size: 1MB plaintext + AES-GCM overhead + buffer
	r.Body = http.MaxBytesReader(w, r.Body, 2<<20+100)

	dataPath := filepath.Join(dir, "data.bin")
	f, err := os.OpenFile(dataPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	defer f.Close()

	if _, err := io.Copy(f, r.Body); err != nil {
		http.Error(w, "write error", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *Handler) FinishUpload(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if !tokenRe.MatchString(token) {
		http.Error(w, "invalid token", http.StatusBadRequest)
		return
	}

	uploadDir := filepath.Join(h.dataDir, "uploads", token)

	metaFile, err := os.Open(filepath.Join(uploadDir, "meta.json"))
	if err != nil {
		http.Error(w, "upload not found", http.StatusNotFound)
		return
	}
	var meta FileMeta
	json.NewDecoder(metaFile).Decode(&meta)
	metaFile.Close()

	dlToken, err := randomToken()
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	dlDir := filepath.Join(h.dataDir, "files", dlToken)
	if err := os.MkdirAll(dlDir, 0755); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	srcData := filepath.Join(uploadDir, "data.bin")
	dstData := filepath.Join(dlDir, "data.bin")
	if err := os.Rename(srcData, dstData); err != nil {
		if err := copyFile(srcData, dstData); err != nil {
			os.RemoveAll(dlDir)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		os.Remove(srcData)
	}

	if err := writeMeta(dlDir, &meta); err != nil {
		os.RemoveAll(dlDir)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	os.RemoveAll(uploadDir)

	writeJSON(w, http.StatusOK, map[string]string{"token": dlToken})
}

func (h *Handler) CancelUpload(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if !tokenRe.MatchString(token) {
		http.Error(w, "invalid token", http.StatusBadRequest)
		return
	}
	os.RemoveAll(filepath.Join(h.dataDir, "uploads", token))
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *Handler) GetMeta(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	if !tokenRe.MatchString(token) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	dlDir := filepath.Join(h.dataDir, "files", token)
	meta, err := readMeta(dlDir)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	if expired(meta) {
		go os.RemoveAll(dlDir)
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	writeJSON(w, http.StatusOK, meta)
}

func (h *Handler) GetChunk(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	if !tokenRe.MatchString(token) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	start, err := strconv.ParseInt(r.PathValue("start"), 10, 64)
	if err != nil || start < 0 {
		http.Error(w, "invalid start", http.StatusBadRequest)
		return
	}
	length, err := strconv.ParseInt(r.PathValue("length"), 10, 64)
	if err != nil || length <= 0 || length > 2<<20+100 {
		http.Error(w, "invalid length", http.StatusBadRequest)
		return
	}

	dlDir := filepath.Join(h.dataDir, "files", token)
	meta, err := readMeta(dlDir)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	// Only enforce time-based expiry here; download-count expiry is enforced at
	// GetMeta (session start). Blocking mid-download on the count would break
	// multi-chunk files when the limit is reached after the first chunk.
	if timeExpired(meta) {
		go os.RemoveAll(dlDir)
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	f, err := os.Open(filepath.Join(dlDir, "data.bin"))
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	defer f.Close()

	if _, err := f.Seek(start, io.SeekStart); err != nil {
		http.Error(w, "seek error", http.StatusInternalServerError)
		return
	}

	buf := make([]byte, length)
	n, err := io.ReadFull(f, buf)
	if err != nil && n == 0 {
		http.Error(w, "read error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Write(buf[:n])

	// Increment download counter on first chunk
	if start == 0 {
		meta.Downloads++
		if err := writeMeta(dlDir, meta); err != nil {
			log.Printf("warning: could not update download count for %s: %v", token, err)
		}
		if meta.ExpireDownloads > 0 && meta.Downloads >= meta.ExpireDownloads {
			go func() {
				time.Sleep(10 * time.Second)
				os.RemoveAll(dlDir)
			}()
		}
	}
}

func timeExpired(meta *FileMeta) bool {
	if meta.ExpireDays > 0 {
		exp := time.Unix(meta.Since, 0).Add(time.Duration(meta.ExpireDays) * 24 * time.Hour)
		return time.Now().After(exp)
	}
	return false
}

func expired(meta *FileMeta) bool {
	if timeExpired(meta) {
		return true
	}
	if meta.ExpireDownloads > 0 && meta.Downloads >= meta.ExpireDownloads {
		return true
	}
	return false
}

// SweepExpired scans every finished file in data/files/ and removes any that
// should no longer be retained: files whose own expiry has passed (time or
// download count) and, as a hard cap, any file older than maxRetention (30
// days). It returns the number of directories removed. Unreadable or
// metadata-less entries are skipped rather than deleted.
func (h *Handler) SweepExpired() (int, error) {
	filesDir := filepath.Join(h.dataDir, "files")
	entries, err := os.ReadDir(filesDir)
	if err != nil {
		return 0, err
	}

	now := time.Now()
	removed := 0
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		dlDir := filepath.Join(filesDir, e.Name())
		meta, err := readMeta(dlDir)
		if err != nil {
			continue // no readable metadata — leave it for a human to inspect
		}
		age := now.Sub(time.Unix(meta.Since, 0))
		if expired(meta) || age >= maxRetention {
			if err := os.RemoveAll(dlDir); err != nil {
				log.Printf("warning: could not delete expired file %s: %v", e.Name(), err)
				continue
			}
			removed++
		}
	}
	return removed, nil
}

// StartCleanupSweep launches a background goroutine that runs the auto-delete
// sweep once immediately and then every interval. Files that expire but are
// never requested would otherwise linger on disk forever (lazy expiry only
// fires on access), so this guarantees the 30-day cap is actually enforced.
func (h *Handler) StartCleanupSweep(interval time.Duration) {
	go func() {
		for {
			if n, err := h.SweepExpired(); err != nil {
				log.Printf("cleanup sweep error: %v", err)
			} else if n > 0 {
				log.Printf("cleanup sweep removed %d expired file(s)", n)
			}
			time.Sleep(interval)
		}
	}()
}

func readMeta(dir string) (*FileMeta, error) {
	f, err := os.Open(filepath.Join(dir, "meta.json"))
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var meta FileMeta
	if err := json.NewDecoder(f).Decode(&meta); err != nil {
		return nil, err
	}
	return &meta, nil
}

func writeMeta(dir string, meta *FileMeta) error {
	f, err := os.Create(filepath.Join(dir, "meta.json"))
	if err != nil {
		return err
	}
	defer f.Close()
	return json.NewEncoder(f).Encode(meta)
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}
