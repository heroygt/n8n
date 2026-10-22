# Issues

## 2026-10-13: Previous container conflict recovered

- The interrupted 2.42.7 recreation encountered a duplicate temporary worker container name. Another authorized recovery completed the rollout and restored all 21 noam88 services.
- At 18:07 Asia/Shanghai, the service inventory contained one running container per service and the accepted rebuilt 2.42.7 image IDs.
- The 2.43.4 native deployment helper checks duplicate service records, holds a stack lock and serializes Compose recreations. These checks prevent the helper from starting with an ambiguous service inventory.

## 2026-10-12: GitHub asset downloads — resolved

- The first dependency install failed when the ripgrep installer received HTTP 403. The Kafka binding download also timed out.
- Command-line installers did not use the configured macOS HTTP proxy.
- Downloaded the official ripgrep archive through that proxy. Verified its SHA-256 against the GitHub release asset metadata.
- The frozen install then passed. Rebuilt the official Kafka binding through the same proxy.
- The upstream lockfile and dependency versions remain unchanged.

## 2026-10-12: noam02 outbound downloads — resolved

- Initial direct Git fetches failed, and native downloads were slow. The user identified the existing proxy configuration in server history.
- The final build uses that proxy for source fetches, dependencies, and Docker build steps. Registry traffic bypasses it.
- Docker native compilation now uses the matching headers already in the pinned builder image.
- The final build, application readiness, native acceptance, and registry publication passed.

## 2026-10-12: main runner registration check — resolved

- The first 2.42.6 rollout check incorrectly required JS/Python registration on both main and worker. Queue mode with manual execution offloading intentionally disables the main broker.
- The reusable deployment helper now verifies registration only where the broker is required and still checks both launcher health endpoints. Read-only 2.42.6 verification and the subsequent 2.42.7 rollout passed.
