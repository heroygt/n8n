# Architecture

## 2026-10-12: Release upgrade

- Use `n8n@2.42.6` (`34ab9c7bf3d0c6d2ec3422e12e0b970aea5717c7`) as the source baseline.
- Keep the existing `my-server` history. Its backup is `codex/backup-my-server-20261012` at `3f48f184f3`.
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
