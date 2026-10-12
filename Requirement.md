# Requirement

## 2026-10-12: Upgrade n8n to 2.42.6

- Upgrade `my-server` from 2.34.6 to the official `n8n@2.42.6` source.
- Original commit: `3f48f184f39cdd292a9707fb1e45659606caa648`.
- Original release: `d743b0ad2e` (2.34.6).
- Keep the Redis pipeline, Docker build, runner settings, and backend changes.
- Keep both Git histories in a merge commit. Create a backup branch first.
- Run the version and source checks before the upgrade. Confirm they fail. Run them again after the upgrade.
- Install dependencies from the official lockfile. Run the build, existing focused tests, package lint, and typecheck. Record each failure.
- Build the final custom n8n and runner images on `noam02`. Use the server's existing image naming and build conventions.
- Publish code to GitHub's `my-server` branch first. The server must fetch that branch before building. Do not use bundles for later source delivery.
- Update the existing `n8n-custom` and `n8n-runner-custom` default `latest` tags. Versioned candidate tags are intermediate acceptance artifacts, not the final delivery names. Preserve rollback image references before updating the default tags.
- Verify the image version and native modules before marking the task complete.
- Original scope: image builds only. Superseded by the noam02 rollout authorization below.

### Acceptance criteria

1. The root and CLI versions are 2.42.6. All other release files match the official tag.
2. Existing local behavior remains available. Resolve conflicts against the new upstream structure.
3. No merge conflicts remain. The check script accepts release and source refs as arguments.
4. Update the feature, architecture, and issue documents with the result.
5. Produce verified 2.42.6 custom images on `noam02`. Record their names, image IDs, build path, and rollback references.

### Completion

- 2026-10-12: All acceptance criteria passed. Both existing custom `latest` tags were updated and pushed to the server registry. Final evidence is recorded in `outputs/n8n-upgrade-2.42.6.md` and its JSON receipts.

### Scope clarification

- 2026-10-12: The user confirmed that the final images must be built on `noam02`. Local compilation alone does not complete the task.
- 2026-10-12: The user requires GitHub `my-server` as the source transfer path. Align the server checkout with `origin/my-server` before continuing.
- 2026-10-12: The user clarified that their custom images use the default tag, without release version tags. Publish the accepted images under the existing `latest` names.

## 2026-10-12: Deploy on noam02 before considering noam88

- Upgrade the running n8n main, worker, and both runner services on noam02 to the accepted custom default images.
- Inspect the active Compose topology and persistent storage first. Preserve deployment configuration and a database backup before migrations.
- Verify version, database readiness, main/worker health, runner connectivity, and the existing frontend route after deployment.
- Record the result and rollback references. Ask the user to confirm the noam02 result after these checks pass.
- Do not upgrade noam88 until the user confirms noam02 and explicitly decides to proceed there.

### Runtime result

- 2026-10-12: noam02 was restarted on 2.42.6. Main/worker readiness, worker JS/Python registration, both launcher health endpoints, and the public route passed. Preserved 232 workflows, 125 active workflows, and 33 credentials. A private backup was taken before 47 migrations (241 to 288).
- User review was superseded by the immediate 2.42.7 upgrade request below. noam88 remains untouched.

## 2026-10-12: Immediate patch upgrade to 2.42.7

- Merge official `n8n@2.42.7`, preserve all custom changes, and deliver source through GitHub `my-server`.
- Rebuild and publish the existing custom default images on noam02, then restart its main, worker, and runner services.
- The user explicitly requests a simpler patch upgrade: do not repeat comprehensive tests. Use source/version checks, the required build, image smoke checks, and runtime readiness verification.
- Preserve rollback images and a private pre-restart backup. Continue to leave noam88 unchanged until separately authorized.
