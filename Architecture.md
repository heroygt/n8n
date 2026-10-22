# Architecture

## 2026-10-22: 2.44.6 source and image build

- Keep official Node 26.12.1 and its builder/runtime digest pins. Retain pnpm 12.4.2, JS runner 2.44.4, launcher 1.5.1 and Python 3.13.
- Keep the new runner libatomic dependency. The previous runner Docker port cannot be applied as a complete file because it would remove this dependency and restore the old Node version.
- Resolve both Dockerfile conflicts with the official files during cherry-pick. Apply custom mirrors, stable release type, local Node headers and native compile cap in the final manual commit.
- Keep all other release files and 103 package manifests unchanged. Build on noam02. This task changes source and image tags only.

## 2026-10-13: 2.43.4 release port

- Official release commit: `69d73b9b6aab9654dcb53b2edf14c823e5f3709d`. Custom replay input remains `ff554c5047`, then `3f48f184f3` from the exact pre-merge HEAD.
- Node remains 26.7.0. pnpm remains 12.4.2. The official JS runner package is 2.43.2 and launcher is 1.5.1. Python runner package remains 0.1.0.
- Retain JS graceful-shutdown and force-kill margin variables, and Python graceful-shutdown variable, in the runner allowlists. They are new upstream settings.
- noam88 recovered after the previous concurrent recreation. All 21 services are running on accepted rebuilt 2.42.7 images. Preserve its current legacy engine and other environment values during this upgrade.

## 2026-10-12: Release upgrade

- Use `n8n@2.42.6` (`34ab9c7bf3d0c6d2ec3422e12e0b970aea5717c7`) as the source baseline.
- Historical merge approach, superseded by the 2026-10-13 replay below. The original customization source is `codex/backup-my-server-20261012` at `3f48f184f3`.
- Apply the seven local file changes from the 2.34.6 baseline. All other source files must match the new tag.
- The upstream release requires Node.js >=24.0.0 and pnpm 12.4.2. Keep the upstream workspace settings, package versions, and lockfile.
- Keep the new Docker `toolchain` and `native-builder` stages. Put the existing Alpine mirror setting in `toolchain`. Keep the `stable` release type.
- Keep the upstream runner launcher and pnpm installation changes. Apply the existing runner mirror and module settings on top.
- Use `scripts/verify-n8n-upgrade.mjs` to check versions, release file differences, retained local files, and merge conflicts. Store detailed logs in `work/n8n-upgrade-2.42.6/`.
- Use `--ported` only for reviewed Docker adaptations. Other changed local files must retain the original patch, or match the original file exactly.
- Use `scripts/check-redis-pipeline.mjs` with an isolated Redis port to check the built node against a real server. It removes only keys under its unique test prefix.
- Build the final Linux images on `noam02`. Read its checkout state and build conventions before changing that checkout.
- Deliver code through GitHub `my-server`: push locally, fetch on `noam02`, and fast-forward to `origin/my-server`. Verify identical commit IDs before each build.
- Preserve existing image IDs before replacing a custom tag. Verify the new images before any service rollout.
- Use `scripts/build-custom-images.mjs` for the server pipeline. It accepts image names, tags, stages, platform, package store, and resource limits as arguments. It writes logs and `summary.json` after each stage.
- The pipeline checks that `HEAD` matches `--source-ref` (default `origin/my-server`) and rejects tracked local changes. `--stage source` runs this check without building images.
- Image acceptance checks the n8n version, native modules, runner interpreters, pnpm version, and custom runner configuration. It also starts a temporary network-isolated n8n container and checks database readiness before removing it.
- Compile the workspace with two concurrent tasks. Reuse that cache for production preparation. Limit isolated-vm native compilation to four jobs by default with `N8N_NATIVE_BUILD_JOBS`.
- Native Docker compilation uses the headers inside the pinned Node builder (`npm_config_nodedir=/usr/local`). This avoids an extra header download and keeps the headers aligned with that exact builder.
- `--push` publishes both versioned images after acceptance succeeds. It is accepted only with `--stage all` or `--stage verify`; record the returned registry digests.
- `--push` publishes both accepted images. Use `--stage promote --verified-report FILE --tag latest --push` to update the existing custom default tags from a successful acceptance report. The script verifies candidate image IDs and saves local rollback tags before changing either default tag.
- Read proxy settings from environment variables. The image stage passes them to both Bake targets through a temporary mode-600 JSON override, then removes it. Do not store proxy credentials in command arguments or Dockerfiles.
- Use `PNPM_CONFIG_STORE_DIR` with pnpm 12. The production preparation script confirms that npm-style config variables are no longer read.

## 2026-10-12: noam02 runtime rollout

- The live stack is managed outside the source checkout: `/data/withPostgresAndWorker/docker-compose.yml`, project `withpostgresandworker`.
- Upgrade only `n8n`, `n8n-worker`, `runner-main`, and `runner-worker`. Keep the PostgreSQL and Redis containers and volumes in place.
- Use `scripts/deploy-custom-images.mjs` with an accepted image receipt and explicit Compose, service, backup, and log parameters. It checks source and image IDs before changes.
- Stop the main process to pause new intake, drain active Redis queue jobs, then stop the worker and runners. Create a private PostgreSQL custom-format dump, n8n storage archive, Redis snapshot, and deployment configuration backup before starting migrations.
- Start the main and wait for database readiness before starting the worker and runners. Verify exact image IDs, environment preservation, health, launcher registration, workflow/credential counts, and the existing public route.
- With queue mode and `OFFLOAD_MANUAL_EXECUTIONS_TO_WORKERS=true`, 2.42.6 does not start a main task broker. Require JS and Python registration on the worker; the retained main runner waits idle. Check both launcher health endpoints.
- A failure before migrations resumes the original containers. Once migrations start, preserve the database snapshot for a controlled recovery rather than silently restoring live data.
- noam88 remains outside the authorized rollout scope until the user confirms noam02 and chooses to proceed there.

## 2026-10-12: 2.42.7 patch rollout

- Merge official `n8n@2.42.7` (`92e4ff858a6ec0dc3ce3995d8696861575698bd0`) into `my-server`. This tag descends directly from 2.42.6; none of its changes overlap the seven custom files.
- Reuse the established server build, image promotion, and deployment scripts with version/log parameters. Keep Node/pnpm, proxy, store, and build cache from the accepted 2.42.6 pipeline.
- Per user instruction, omit comprehensive tests; source fidelity, build completion, quick image smoke checks, and live readiness are the acceptance gates.

## 2026-10-12: noam88 native queue stack

- Authorization now includes noam88. Compose project `n8n-docker` at `/data/n8n-docker/docker-compose.yml` contains one main, two webhook processors, eight workers, nine runners, and an nginx proxy.
- PostgreSQL and Redis run natively on noam88; containers connect through `host.docker.internal` (`172.17.0.1`). The queue uses Redis database 15. Preserve these services and the proxy container.
- Pull the exact custom image digests accepted on noam02. Fetch deployment scripts through GitHub `my-server`; no build is needed on noam88.
- Use `scripts/deploy-native-custom-stack.py` for this topology. Pause the Bull queue, stop ingress, drain active jobs, then stop workers/runners. Back up PostgreSQL, scoped queue keys, private configuration, and each writable `.n8n` directory before migrations.
- These containers have no storage mounts. Recreate containers without starting them, restore their `.n8n` archives, then start main for migrations before the other application services. Verify all worker registrations and reload the retained proxy.
- Existing workers lack the `N8N_PROXY_HOPS` setting already declared in Compose. Allow this one nonsecret configuration difference when recreating them; retain all sensitive settings. Other configuration differences must be explicitly reviewed.

## 2026-10-13: Linear release replay

- The pre-upgrade customization source is exactly `3f48f184f3`, the first parent of the first merge. Replay only `ff554c5047` and `3f48f184f3` onto official 2.42.7.
- The n8n Dockerfile conflicts because upstream replaced the single builder with `toolchain` and `native-builder`. Defer its customization while cherry-picking, then apply it in the final manual commit: keep Node 26.7.0, pinned upstream images, native build layout and runtime copies; move the original Alpine mirror into `toolchain` and retain `stable`.
- Retain the validated manual native-header setting and build-job cap, deployment helpers and historical records in that final commit. Product and Docker source must match the already accepted custom 2.42.7 tree.
- Runner Docker changes merge automatically. Retain official Node 26.7.0, pnpm 12.4.2, launcher 1.5.0, JS runner package 2.42.5, Python 3.13 and Python runner package 0.1.0. Component versions need not equal the application version.
- `verify-n8n-upgrade.mjs --linear-from REF --cherry-picked REF ... --manual-tip` verifies ancestry, zero upgrade merges, exact cherry-pick provenance/order and one final manual commit.
- Old merged tip `9a29951582` is preserved on GitHub as `codex/backup-my-server-before-replay-20261013`; old pre-merge source is also preserved as `codex/pre-upgrade-my-server-20261013`.
- A server checkout on the old history will not fast-forward to the rewritten branch. Preserve its local state before aligning it with the fetched `origin/my-server` for a future build; running containers are independent of the checkout history.

## Redis upstream operation compatibility

The old custom Redis pipeline omitted the official LLEN operation. Its three existing upstream tests fail. Restore its operation and List parameter in the final manual port. Queue lLen on the existing pipeline and retain input/result ordering. Existing error and continue-on-fail handling applies. Retain the custom delete and keys output shapes.

Update upstream Redis test mocks for multi/exec and SCAN. Keep error-path assertions. Add a batch-length ordering case. All 30 Redis tests now pass. The core additional-keys suite passes all 17 tests. The image acceptance script also checks LLEN with real Redis, including a missing list.
