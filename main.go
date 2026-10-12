package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"embed"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"math/big"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"alligatorbox/handlers"
)

// staticFiles embeds the static/ directory into the binary so the server is
// self-contained and does not need the static/ folder present on disk.
// The "all:" prefix ensures files that would otherwise be skipped are included.
//
//go:embed all:static
var staticFiles embed.FS

func main() {
	dataDir := "data"
	if err := os.MkdirAll(filepath.Join(dataDir, "uploads"), 0755); err != nil {
		log.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dataDir, "files"), 0755); err != nil {
		log.Fatal(err)
	}

	port     := flag.Int("p", 8080, "port to listen on")
	bind     := flag.String("b", "127.0.0.1", "interface address to bind to (e.g. 0.0.0.0 for all interfaces)")
	tlsMode  := flag.Bool("tls", false, "enable HTTPS with self-signed certificate")
	certFile := flag.String("cert", "", "path to TLS cert PEM (default: data/cert.pem)")
	keyFile  := flag.String("key",  "", "path to TLS key  PEM (default: data/key.pem)")
	flag.Parse()

	h := handlers.New(dataDir)

	// Start the background auto-delete sweep: removes files older than 30 days
	// (and any shorter user-set expiry) immediately at startup, then hourly.
	h.StartCleanupSweep(time.Hour)

	mux := http.NewServeMux()

	// API routes
	mux.HandleFunc("POST /api/file/new", h.NewFile)
	mux.HandleFunc("PUT /api/file/chunk", h.UploadChunk)
	mux.HandleFunc("POST /api/file/finish", h.FinishUpload)
	mux.HandleFunc("POST /api/file/cancel", h.CancelUpload)
	mux.HandleFunc("GET /api/file/meta/{token}", h.GetMeta)
	mux.HandleFunc("GET /api/file/chunk/{token}/{start}/{length}", h.GetChunk)

	// Choose the static file source: prefer an on-disk static/ directory when
	// it exists (convenient for local development / live edits), otherwise fall
	// back to the copy embedded in the binary so the server works standalone.
	var staticSrc fs.FS
	if info, err := os.Stat("static"); err == nil && info.IsDir() {
		staticSrc = os.DirFS("static")
		log.Print("serving static assets from on-disk static/ directory")
	} else {
		sub, err := fs.Sub(staticFiles, "static")
		if err != nil {
			log.Fatal(err)
		}
		staticSrc = sub
		log.Print("serving static assets embedded in the binary")
	}

	// Static file server for /assets/*
	staticFS := http.FileServer(http.FS(staticSrc))

	serveStatic := func(w http.ResponseWriter, r *http.Request, name string) {
		f, err := staticSrc.Open(name)
		if err != nil {
			http.Error(w, "404 page not found", http.StatusNotFound)
			return
		}
		defer f.Close()
		info, err := f.Stat()
		if err != nil {
			http.Error(w, "500 internal server error", http.StatusInternalServerError)
			return
		}
		rs, ok := f.(io.ReadSeeker)
		if !ok {
			http.Error(w, "500 internal server error", http.StatusInternalServerError)
			return
		}
		http.ServeContent(w, r, name, info.ModTime(), rs)
	}

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if path == "/" {
			serveStatic(w, r, "index.html")
			return
		}
		if strings.HasPrefix(path, "/assets/") {
			staticFS.ServeHTTP(w, r)
			return
		}
		// Any other path is treated as a download token
		serveStatic(w, r, "download.html")
	})

	addr := fmt.Sprintf("%s:%d", *bind, *port)

	if *tlsMode {
		certPath := *certFile
		keyPath  := *keyFile
		if certPath == "" {
			certPath = filepath.Join(dataDir, "cert.pem")
		}
		if keyPath == "" {
			keyPath = filepath.Join(dataDir, "key.pem")
		}

		// Generate self-signed cert/key if they don't exist yet.
		if _, err := os.Stat(certPath); os.IsNotExist(err) {
			if err := generateSelfSignedCert(certPath, keyPath); err != nil {
				log.Fatal("failed to generate TLS certificate: ", err)
			}
			log.Print("generated self-signed TLS certificate at ", certPath)
		}

		log.Printf("AlligatorBox listening on https://%s", addr)
		log.Fatal(http.ListenAndServeTLS(addr, certPath, keyPath, mux))
	} else {
		log.Printf("AlligatorBox listening on http://%s", addr)
		log.Fatal(http.ListenAndServe(addr, mux))
	}
}

// generateSelfSignedCert creates an ECDSA P-256 self-signed certificate
// valid for localhost (both DNS names and IP address). The cert/key pair
// is written as PEM files to the given paths. On restarts, existing files
// are reused so the browser warning only appears once per user.
func generateSelfSignedCert(certPath, keyPath string) error {
	// Ensure the parent directory exists.
	if err := os.MkdirAll(filepath.Dir(certPath), 0755); err != nil {
		return fmt.Errorf("create cert dir: %w", err)
	}

	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return fmt.Errorf("generate key: %w", err)
	}

	template := x509.Certificate{
		SerialNumber: big.NewInt(time.Now().UnixNano()),
		Subject: pkix.Name{
			CommonName:   "alligatorbox",
			Organization: []string{"AlligatorBox"},
		},
		NotBefore:    time.Now(),
		NotAfter:     time.Now().Add(365 * 24 * time.Hour), // 1 year
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		MaxPathLen:   0,
		MaxPathLenZero: true,
	}

	// Subject Alternative Names — both localhost DNS and loopback IP.
	template.DNSNames = []string{"localhost"}
	template.IPAddresses = []net.IP{net.ParseIP("127.0.0.1")}

	certDER, err := x509.CreateCertificate(rand.Reader, &template, &template, &priv.PublicKey, priv)
	if err != nil {
		return fmt.Errorf("create certificate: %w", err)
	}

	// Write cert PEM.
	cf, err := os.OpenFile(certPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0644)
	if err != nil {
		return fmt.Errorf("write cert: %w", err)
	}
	pem.Encode(cf, &pem.Block{Type: "CERTIFICATE", Bytes: certDER})
	cf.Close()

	// Write key PEM.
	keyBytes, err := x509.MarshalECPrivateKey(priv)
	if err != nil {
		return fmt.Errorf("marshal key: %w", err)
	}
 kf, _ := os.OpenFile(keyPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
	pem.Encode(kf, &pem.Block{Type: "EC PRIVATE KEY", Bytes: keyBytes})
	kf.Close()

	return nil
}
