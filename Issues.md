# Issues

## 2026-10-12: GitHub asset downloads — resolved

- The first dependency install failed when the ripgrep installer received HTTP 403. The Kafka binding download also timed out.
- Command-line installers did not use the configured macOS HTTP proxy.
- Downloaded the official ripgrep archive through that proxy. Verified its SHA-256 against the GitHub release asset metadata.
- The frozen install then passed. Rebuilt the official Kafka binding through the same proxy.
- The upstream lockfile and dependency versions remain unchanged.
