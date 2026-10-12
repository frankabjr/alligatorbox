#!/usr/bin/env bash
#
# build.sh — cross-compile AlligatorBox into static, self-contained binaries
# for every supported platform.
#
# The server is pure Go standard library with the frontend embedded via
# embed.FS, so cross-compilation needs no per-platform toolchain and the
# resulting binary is fully self-contained (it creates its own data/ at runtime).
#
# Usage:
#   ./build.sh                 Build all platforms (default)
#   ./build.sh <target>        Build one platform, e.g. linux-amd64
#   ./build.sh clean           Remove all built binaries
#   ./build.sh --help          Show this help
#
# Targets:
#   linux-amd64    -> alligatorbox-linux-amd64        (Linux x86-64)
#   darwin-arm64   -> alligatorbox-macos-arm64        (macOS, Apple Silicon)
#   darwin-amd64   -> alligatorbox-macos-amd64        (macOS, Intel)
#   windows-amd64  -> alligatorbox-windows-amd64.exe  (Windows x86-64)
#
set -euo pipefail

# Build from the project root no matter where the script is invoked from.
cd "$(dirname "$0")"

# ── Configuration ────────────────────────────────────────────────────────────
# Minimum Go version required (must match the go.mod directive).
MIN_GO="1.22"
# Platforms built when no target is given.
ALL_TARGETS=(linux-amd64 darwin-arm64 darwin-amd64 windows-amd64)

# ── Helpers ──────────────────────────────────────────────────────────────────

# Print "goos goarch output" for a target name, or return 1 if unknown.
resolve_target() {
  case "$1" in
    linux-amd64)   echo "linux   amd64   alligatorbox-linux-amd64" ;;
    darwin-arm64)  echo "darwin  arm64   alligatorbox-macos-arm64" ;;
    darwin-amd64)  echo "darwin  amd64   alligatorbox-macos-amd64" ;;
    windows-amd64) echo "windows amd64   alligatorbox-windows-amd64.exe" ;;
    *) return 1 ;;
  esac
}

usage() {
  cat <<'EOF'
build.sh — cross-compile AlligatorBox into static, self-contained binaries.

Usage:
  ./build.sh                 Build all platforms (default)
  ./build.sh <target>        Build one platform
  ./build.sh clean           Remove all built binaries
  ./build.sh --help          Show this help

Targets:
  linux-amd64    -> alligatorbox-linux-amd64        (Linux x86-64)
  darwin-arm64   -> alligatorbox-macos-arm64        (macOS, Apple Silicon)
  darwin-amd64   -> alligatorbox-macos-amd64        (macOS, Intel)
  windows-amd64  -> alligatorbox-windows-amd64.exe  (Windows x86-64)
EOF
}

require_go() {
  if ! command -v go >/dev/null 2>&1; then
    echo "error: 'go' not found on PATH — install Go ${MIN_GO}+ from https://go.dev/dl/" >&2
    exit 1
  fi
  local ver
  ver="$(go env GOVERSION | sed 's/^go//')"   # e.g. 1.26.5
  # sort -V: the larger of (ver, MIN_GO). If it isn't ver, then ver < MIN_GO.
  if [ "$(printf '%s\n%s\n' "$ver" "$MIN_GO" | sort -V | tail -n1)" != "$ver" ]; then
    echo "error: Go ${MIN_GO}+ required (found go $ver)" >&2
    exit 1
  fi
  echo "using go $ver"
}

build_one() {
  local goos goarch out
  read -r goos goarch out <<< "$(resolve_target "$1")"
  echo "-> $out  ($goos/$goarch)"
  # CGO_ENABLED=0 => static binary, no dynamic-link dependencies.
  # -ldflags "-s -w" strips the symbol table and DWARF debug info (smaller).
  GOOS="$goos" GOARCH="$goarch" CGO_ENABLED=0 \
    go build -ldflags "-s -w" -o "$out" .
}

cmd_clean() {
  echo "removing built binaries..."
  rm -f alligatorbox-linux-amd64 \
        alligatorbox-macos-arm64 \
        alligatorbox-macos-amd64 \
        alligatorbox-windows-amd64.exe
  echo "done."
}

list_built() {
  echo
  echo "built:"
  local out
  for t in "$@"; do
    read -r _ _ out <<< "$(resolve_target "$t")"
    ls -lh "$out"
  done
}

# ── Entry point ──────────────────────────────────────────────────────────────
main() {
  case "${1:-all}" in
    clean)          cmd_clean ;;
    -h|--help|help) usage ;;
    all)
      require_go
      for t in "${ALL_TARGETS[@]}"; do build_one "$t"; done
      list_built "${ALL_TARGETS[@]}"
      ;;
    *)
      if resolve_target "$1" >/dev/null 2>&1; then
        require_go
        build_one "$1"
        list_built "$1"
      else
        echo "error: unknown target '$1'" >&2
        echo >&2
        usage >&2
        exit 1
      fi
      ;;
  esac
}

main "$@"
