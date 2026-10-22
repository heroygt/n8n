# Custom n8n 2.44.6 images

Date: 2026-10-22. Status: source port and local checks complete; server images pending. No production deployment is authorized.

## Source

- Official release: n8n@2.44.6, b58d9e89d60e9a3485bb511c5091d8be0d9511e4.
- Original pre-merge source: 3f48f184f39cdd292a9707fb1e45659606caa648 on 2.34.6.
- Replay ff554c5047 as 443df0ca84, then 3f48f184f3 as 3123cc1d58. One final manual commit follows them.
- Preserve the previous my-server source 00002a8361 under a GitHub backup branch before publishing this new release. Use an exact force-with-lease for the release branch replacement.

## Conflicts and upstream versions

Both Dockerfiles conflict with the original custom commit. Keep official files during cherry-pick. Apply their reviewed custom settings in the final manual commit.

The n8n Dockerfile keeps the pinned Node 26.12.1 builder/runtime images and separate native builder. Restore the existing mirror, stable release type, local Node headers and four-job native build cap.

The runner Dockerfile keeps Node 26.12.1 and the new libatomic package. Restore the existing Python/launcher/runtime mirror and download settings. Retain pnpm 12.4.2, launcher 1.5.1, Python 3.13 and JS runner package 2.44.4. The runner JSON merges automatically and retains the custom module settings and upstream shutdown environment fields.

Redis, backend and resume URL changes apply without conflicts. All 103 release manifests must match upstream.

## Acceptance and publication

Build both images on noam02 from GitHub my-server. Use the existing proxy and umask 022. Run source/history checks, frozen install, build, focused package checks and network-isolated image smoke checks. Do not repeat comprehensive or performance tests.

Promote accepted images to the existing n8n-custom:latest and n8n-runner-custom:latest names. Preserve rollback image references. Image IDs and registry manifest digests will be recorded after acceptance.

## Production boundary

Do not run deployment helpers or Compose operations. Do not change credentials, workflows, databases, Redis or environment configuration. Compare existing noam02 container IDs, image IDs and start times after image publication. Live services remain on custom 2.43.4. Keep explicit legacy settings on both servers for any future deployment.

## Redis upstream operation compatibility

The old custom Redis pipeline omitted the official LLEN operation. Its three existing upstream tests fail. Restore its operation and List parameter in the final manual port. Queue lLen on the existing pipeline and retain input/result ordering. Existing error and continue-on-fail handling applies. Retain the custom delete and keys output shapes.

Update upstream Redis test mocks for multi/exec and SCAN. Keep error-path assertions. Add a batch-length ordering case. All 30 Redis tests now pass. The core additional-keys suite passes all 17 tests. The image acceptance script also checks LLEN with real Redis, including a missing list.

## Local validation

- The initial source and history check fails before replay, as expected.
- Frozen pnpm 12.4.2 install passes. The full local build passes all 72 tasks in 2 minutes 21 seconds.
- Lint and typecheck pass for nodes-base, CLI, core and backend-common. Repeat nodes-base checks after the Redis compatibility fix.
- The original Redis suite fails 14 tests before mock adaptation. Three LLEN tests expose the old missing operation. All 30 Redis tests pass after the manual compatibility port, including batch ordering. The additional-keys suite passes all 17 tests.
- Keep the real-Redis image acceptance check as an additional gate. Source, build and smoke checks do not modify production.

The source verifier now accepts an explicitly declared manual port when upstream left that custom file unchanged. It still rejects an undeclared change. A temporary Git fixture verifies both cases, with a red result before this correction and a green result after it.

## Cached image artifact permissions

The first 2.44.6 candidate passes native and runner checks but fails temporary startup because a packaged dependency is not readable by the image user. Umask 022 alone does not repair restrictive existing artifact modes. The build helper now runs scripts/normalize-image-artifacts.sh before every image stage. It changes only compiled, dist/task-runner-javascript and docker/images. A red-to-green fixture confirms public files and executable traversal become readable while private files remain mode 600. Rebuild the images and rerun acceptance before publication.
