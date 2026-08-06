# Contributing to AlligatorBox

Thanks for your interest in contributing! This document covers how to get started, coding standards, and the submission process.

## Project Philosophy

- **Minimalism** — The server uses only the Go standard library. No external packages, no build step, no JavaScript framework. Keep it that way unless there's a compelling reason.
- **Client-side security** — All crypto happens in the browser. The server never sees plaintext or passwords. This is non-negotiable.
- **Simplicity** — Small codebase, clear intent. One thing per file. No over-engineering.

## Getting Started

```bash
# Clone the repo
git clone https://github.com/<username>/alligator-team.git
cd alligator-team

# Run the server
export PATH=$PATH:/usr/local/opt/go/bin
go run .

# Open in browser
open http://localhost:8080
```

The server listens on `http://127.0.0.1:8080` by default. No setup beyond Go 1.22+ is required.

## Making Changes

1. **Create a branch** from `main` for your work.
   ```bash
   git checkout -b <description>
   ```
2. **Edit and test locally.** The app requires no external services — just `go run .` and open the browser.
3. **Commit with clear messages.** Describe what changed and why.

## Code Style Guidelines

### Go (Backend)

- Follow the [Go Code Review Comments](https://github.com/golang/go/wiki/CodeReviewComments) guide.
- No external dependencies — only `net/http`, `crypto`, `encoding`, `io`, `os`, `regexp`, and friends.
- Error handling: fail loudly for unrecoverable errors (`log.Fatal`), return errors where the caller can handle them.
- Functions should be short and focused. If a function grows past ~60 lines, consider splitting it.

### JavaScript (Frontend)

- Vanilla JS only — no frameworks, no bundlers.
- Use `const`/`let` (not `var`). Arrow functions are fine.
- One responsibility per script: `crypto-utils.js` for crypto, `upload.js` for upload logic, `download.js` for download logic.
- Comment non-obvious logic (especially crypto-related code).

### CSS

- Dark theme by design — keep that aesthetic.
- Use CSS variables (`var(--color)`) for colors and spacing to maintain consistency.
- No external frameworks or resets.

## Submitting a Pull Request

1. **Describe the change** in the PR body. What problem does it solve? What does it change?
2. **Include screenshots** if the UI changed — before/after is best.
3. **Test manually** — upload and download files, try error cases, verify expiry behavior.
4. **Keep it focused** — one feature or fix per PR. Large PRs are harder to review.

## Reporting Issues

- **Bug reports:** Include steps to reproduce, expected vs actual behavior, and browser/OS version if relevant.
- **Feature requests:** Explain the use case. Is this aligned with the project's minimalism principle?
- **Security concerns:** Please report them privately before disclosing publicly. See [SECURITY.md](SECURITY.md).

## License

This project is released under the [CC0 1.0 Universal license](https://creativecommons.org/publicdomain/zero/1.0/). By contributing, you agree that your contributions are also dedicated to the public domain under this license.
