package handlers

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// makeFile creates a finished-file directory with a meta.json whose `Since`
// timestamp is set `age` in the past, for use by SweepExpired tests.
func makeFile(t *testing.T, h *Handler, token string, age time.Duration, m FileMeta) {
	t.Helper()
	dlDir := filepath.Join(h.dataDir, "files", token)
	if err := os.MkdirAll(dlDir, 0755); err != nil {
		t.Fatal(err)
	}
	m.Since = time.Now().Add(-age).Unix()
	if err := writeMeta(dlDir, &m); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dlDir, "data.bin"), []byte("ciphertext"), 0644); err != nil {
		t.Fatal(err)
	}
}

func TestSweepExpired(t *testing.T) {
	dir := t.TempDir()
	h := New(dir)

	// Old file: 31 days old, no user expiry -> removed by the 30-day hard cap.
	makeFile(t, h, "0123456789abcdef0123456789abcdef", 31*24*time.Hour,
		FileMeta{Name: "enc", ExpireDays: 0, ExpireDownloads: 0})

	// Short-expiry file: 11 days old but only a 10-day expiry -> removed by expired().
	makeFile(t, h, "fedcba9876543210fedcba9876543210", 11*24*time.Hour,
		FileMeta{Name: "enc", ExpireDays: 10, ExpireDownloads: 0})

	// Download-limit file: limit 1, already downloaded once -> removed by expired().
	makeFile(t, h, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", 1*time.Hour,
		FileMeta{Name: "enc", ExpireDays: 0, ExpireDownloads: 1, Downloads: 1})

	// Fresh file: just uploaded, no expiry -> kept.
	makeFile(t, h, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", 1*time.Hour,
		FileMeta{Name: "enc", ExpireDays: 0, ExpireDownloads: 0})

	removed, err := h.SweepExpired()
	if err != nil {
		t.Fatalf("SweepExpired error: %v", err)
	}
	if removed != 3 {
		t.Fatalf("expected 3 files removed, got %d", removed)
	}

	// The three expired files must be gone.
	for _, token := range []string{
		"0123456789abcdef0123456789abcdef",
		"fedcba9876543210fedcba9876543210",
		"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	} {
		if _, err := os.Stat(filepath.Join(dir, "files", token)); !os.IsNotExist(err) {
			t.Errorf("expired file %s should have been removed", token)
		}
	}
	// The fresh file must remain.
	if _, err := os.Stat(filepath.Join(dir, "files", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")); err != nil {
		t.Errorf("fresh file should have been kept, got: %v", err)
	}
}

func TestSweepExpiredEmptyDir(t *testing.T) {
	dir := t.TempDir()
	h := New(dir)
	// New doesn't create the files/ directory; the sweep must handle an empty one.
	if err := os.MkdirAll(filepath.Join(dir, "files"), 0755); err != nil {
		t.Fatal(err)
	}
	removed, err := h.SweepExpired()
	if err != nil {
		t.Fatalf("SweepExpired error: %v", err)
	}
	if removed != 0 {
		t.Fatalf("expected 0 removed on empty dir, got %d", removed)
	}
}
