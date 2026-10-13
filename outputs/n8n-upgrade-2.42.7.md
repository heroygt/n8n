# n8n 2.42.7 custom rollout

Date: 2026-10-12. Status: deployed and verified on noam02; awaiting user review.

- Target: official `n8n@2.42.7`, `92e4ff858a6ec0dc3ce3995d8696861575698bd0`.
- Upgrade merge: `ce7dfb02d772af7096857b12913f2e06aad4eb3e`. Server build source: `903bc4c341d71f51bea2106db95b87c892a9fbf4`.
- Source delivery: GitHub `heroygt/n8n`, branch `my-server`, fetched and fast-forwarded on noam02 before building.
- Source checks passed: 96 release manifests, upstream source outside declared local files, seven retained custom files, and no merge conflicts.
- The user requested a simple patch upgrade without repeating comprehensive tests. Reuse the established build and deployment scripts; acceptance is limited to source/version, build completion, image smoke checks, and runtime readiness.
- Final image names remain `10.132.134.63:5000/n8n-custom:latest` and `10.132.134.63:5000/n8n-runner-custom:latest`. Versioned candidates are intermediate artifacts.
- Reuse the Node 24.14.1 host runtime, pnpm 12.4.2, proxy, dependency store, and Docker cache from the 2.42.6 build. Final images are built on noam02.
- Live Compose: `/data/withPostgresAndWorker/docker-compose.yml`, project `withpostgresandworker`. Recreate main, worker, and both runners after image acceptance and backup. Keep PostgreSQL and Redis in place.
- Queue mode uses `OFFLOAD_MANUAL_EXECUTIONS_TO_WORKERS=true`: require worker JS/Python registration; the retained main runner waits idle.
- Server pipeline log: `/data/n8n/work/n8n-upgrade-2.42.7.log`. Build, promotion, and runtime receipts are under `/data/n8n/work/n8n-upgrade-2.42.7/`.
- noam88 remains unchanged and requires a separate user decision after noam02 review.

## Published images

| Default image | Image ID | Registry digest |
| --- | --- | --- |
| `10.132.134.63:5000/n8n-custom:latest` | `80e7c25cb4bc` | `sha256:56a710940d1087af56ff93a7ce8785b7da06d8e0fbc6487d95ad84da648b3d0a` |
| `10.132.134.63:5000/n8n-runner-custom:latest` | `b7681852f9ab` | `sha256:a7f09b6e632c633f4b7da9927eff76264dc398ea510a5cb3f46c54089620b711` |

## Runtime result

- Dependency install, 71 build tasks (30 cached), production packaging, both image builds, quick image smoke checks, and publication passed. Workspace compilation took 1m54s. No comprehensive tests were repeated.
- The deployment script drained active jobs, saved and checked private backups, then recreated main/worker and both runners. Both n8n processes report 2.42.7.
- Main/worker database readiness, both launcher health endpoints, worker JS/Python registration, and the public route passed. The public route returns HTTP 200. All four application containers are running with zero restarts.
- Database counts remain 232 workflows, 125 active workflows, 33 credentials, and 288 migrations. This patch added no migrations. Encryption keys, database passwords, and runner auth settings are preserved.
- PostgreSQL and Redis kept their original container IDs and volumes. noam88 is unchanged.
- Sanitized evidence: `outputs/n8n-upgrade-2.42.7-deployment.json`. Full logs remain on noam02 under the pipeline directory above.
- Review URL: https://noam-n8n.nioint.com . The user should confirm noam02 before deciding whether to upgrade noam88.

## Backup and rollback

- Private pre-restart backup: `/data/withPostgresAndWorker/upgrade-backups/n8n-2.42.7-20261012094831`, containing a PostgreSQL archive, n8n storage, Redis snapshot, and deployment configuration. Archives and SHA-256 receipts were checked.
- Previous 2.42.6 main image: `74daf4d61991`, retained as `10.132.134.63:5000/n8n-custom:latest-rollback-20261012094730`.
- Previous 2.42.6 runner image: `b2e721c07379`, retained as `10.132.134.63:5000/n8n-runner-custom:latest-rollback-20261012094730`.
- Rollback tags are local to noam02. Restoring runtime containers requires recreation with the rollback images; changing a tag alone does not update a running container.
