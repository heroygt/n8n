# Function

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
- The user subsequently authorized the immediate 2.42.7 patch upgrade; this is now the active target.
