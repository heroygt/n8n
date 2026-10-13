# Function

## 2026-10-13: 2.43.4 source upgrade

- The custom source is reconstructed on official 2.43.4 with the two original cherry-picks and final manual Docker adaptations. Original backend, resume URL and Redis behavior remain present.
- Retain official JS runner 2.43.2, launcher 1.5.1 and the new runner shutdown settings. All 102 release manifests match upstream.
- Frozen installation, local build, package lint/typechecks and deployment regression checks pass. The final server image build and live rollout are pending.

## 2026-10-12: n8n 2.42.6

Status: complete. The final custom default images were built, accepted, and published on `noam02`.

- The root and CLI versions are 2.42.6. All 96 release manifests match the target tag.
- Keep Redis batch commands, `mget`, `mset`, automatic type lookup, and missing-key handling.
- Keep the existing relative resume URL fallback and backend settings.
- Keep the Alpine mirrors, stable image release type, and runner module settings.
- The new release blocks additions or changes to deprecated nodes by default. Saved workflows with these nodes can still run. `N8N_DEPRECATED_NODES_BLOCK=false` permits older imports when required.
- The Gemini image model list includes the new upstream models.
- Published `10.132.134.63:5000/n8n-custom:latest` (`74daf4d61991`) and `10.132.134.63:5000/n8n-runner-custom:latest` (`b2e721c07379`), both labeled 2.42.6.
- Application readiness, native modules, runner interpreters, and exact custom runner configuration passed. Registry default tag digests match the acceptance receipts.
- Historical image-only result: the service containers initially retained the previous images. The authorized runtime rollout below supersedes this state.

Validation details belong in `outputs/n8n-upgrade-2.42.6.md`. Detailed logs belong in `work/n8n-upgrade-2.42.6/`.

## 2026-10-12: noam02 runtime

- Main, worker, and both runners were recreated using the accepted 2.42.6 custom images. PostgreSQL and Redis retained their container IDs and volumes.
- Readiness, both launcher health endpoints, worker JS/Python registration, and the public route passed. Workflows/active workflows/credentials remain 232/125/33; migrations are now 288.
- Queue mode offloads manual execution to the worker, so the main broker is intentionally absent. A real worker execution completed after rollout.
- The user subsequently authorized the immediate 2.42.7 patch upgrade, completed below.

## 2026-10-12: Current noam02 version 2.42.7

Status: deployed and verified; awaiting user review.

- Main/worker now run custom `latest` image `80e7c25cb4bc`; both runners use `b7681852f9ab`. The original seven customizations remain.
- Source was delivered through GitHub `my-server`, built on noam02, accepted with quick image smoke checks, and published under the existing default tags.
- All four application services are running with zero restarts. Main/worker readiness, both launcher health endpoints, worker JS/Python registration, and the public route passed.
- Workflows/active workflows/credentials/migrations remain 232/125/33/288. Sensitive settings and the PostgreSQL/Redis containers are preserved. Private backups and 2.42.6 rollback image references are retained.
- Comprehensive tests were not repeated, as requested. noam88 remains unchanged.

## 2026-10-13: Clean customization history

- The 2.42.7 product tree is reconstructed from the pre-merge 2.34.6 customizations using two cherry-picks, followed by a final manual adaptation commit.
- Runtime behavior and accepted Docker source remain identical to the previously verified custom release. New verification options enforce the requested linear history and commit provenance.
- Read-only noam88 check: all 20 custom application services are running on accepted 2.42.7 image IDs, with zero restarts; its proxy returns HTTP 200. This check supersedes the earlier pending noam88 state without claiming a complete execution-history backup.
