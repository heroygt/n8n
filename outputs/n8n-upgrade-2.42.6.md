# n8n 2.42.6 custom image delivery

Date: 2026-10-12. Status: complete.

The existing custom default tags were built, accepted, and published on `noam02`. Both images report version 2.42.6 and use Linux amd64.

## Source

- Delivery branch: GitHub `heroygt/n8n`, `my-server`.
- Original source: `3f48f184f39cdd292a9707fb1e45659606caa648`, based on n8n 2.34.6.
- Official target: `n8n@2.42.6`, `34ab9c7bf3d0c6d2ec3422e12e0b970aea5717c7`.
- Upgrade merge: `3ddc4d99f426a8dfadea3c6cc12bc6fbe6af3660`. Both Git histories are retained.
- Accepted image build source: `7cf85e1c82ac14753480819bf27bc2fc4936df8f`, fetched from GitHub before the final build.
- Default tag promotion source: `526bb8c741f30361cbf500929e96aabe6bacd082`, fetched from the same branch.
- Source backup ref: `codex/backup-my-server-20261012`, retained locally and on noam02.

The seven existing custom files remain: both Dockerfiles, runner module settings, both backend settings files, relative resume URL handling, and the Redis pipeline. All other release files and all 96 package manifests match the official target.

## Final images

| Default image | Image ID | Registry manifest digest |
| --- | --- | --- |
| `10.132.134.63:5000/n8n-custom:latest` | `74daf4d61991` | `sha256:d615e1fa692906df4e355d0f6ee58d5ce2d650df123928ea2cead8e432d535ee` |
| `10.132.134.63:5000/n8n-runner-custom:latest` | `b2e721c07379` | `sha256:0d4eea0aa793e7d3e530fca7985504f52c860d5a7afb3bd8852df723c3930ee6` |

Registry HEAD requests for both `latest` manifests returned HTTP 200 with these exact digests. Versioned tags were intermediate acceptance artifacts. The default custom tags are the final delivery.

Full IDs, sizes, stages, timings, and previous image references are in the adjacent JSON receipts: `n8n-upgrade-2.42.6-build.json` and `n8n-upgrade-2.42.6-publish.json`.

## Validation

| Check | Result |
| --- | --- |
| Source verification before upgrade | Failed as expected: source was 2.34.6 |
| Source verification after upgrade | Passed; 96 release manifests and retained custom patches checked |
| Frozen dependency install | Passed locally and on noam02 |
| Workspace build | Passed; 71 local build tasks, server build and production packaging passed |
| Package lint and typecheck | Passed in backend-common, core, nodes-base, and CLI |
| Existing focused unit tests | 555 passed |
| Real Redis pipeline acceptance | Five groups passed: batching/order, mget/mset and missing keys, automatic types, keys/values, and increment/delete |
| Docker native modules | SQLite, isolated-vm, and Kafka passed; librdkafka 2.14.1 includes TLS and SASL SCRAM |
| Runner acceptance | Node 26.7.0, Python 3.13.14, pnpm 12.4.2, and exact custom configuration passed |
| Application startup | Temporary network-isolated container reached database readiness; removed after acceptance |
| Source and promotion guards | Wrong source ref and failed acceptance report were rejected before image changes |
| Default tag publication | Both accepted image IDs promoted and pushed; registry digests verified |

The unit run is focused, not the full repository suite. Fourteen sequential Redis cases use mocks incompatible with the retained pipeline; these were excluded, and the custom behavior was checked against a real Redis server.

## Server build

- Checkout: `/data/n8n` on `noam02`.
- Isolated host runtime: Node 24.14.1 and pnpm 12.4.2 under `/data/n8n/work/n8n-upgrade-2.42.6/runtime`.
- Build logs and receipts: `/data/n8n/work/n8n-upgrade-2.42.6/server-final` and `server-promote`.
- Existing server proxy: `http://10.110.63.114:8080`, supplied through both cases of HTTP/HTTPS proxy variables. Localhost and internal registry hosts bypass it.
- Docker receives proxy variables through a temporary Bake override. Native compilation uses the matching headers inside the pinned Node builder and four isolated-vm jobs.
- Dependencies and Docker storage remain on `/data`.

For future upgrades, push `my-server` to GitHub first, fetch and fast-forward that branch on noam02, and use the build script with a candidate tag. After acceptance, update the default tags with:

```sh
node scripts/build-custom-images.mjs \
  --image 10.132.134.63:5000/n8n-custom \
  --runners-image 10.132.134.63:5000/n8n-runner-custom \
  --version 2.42.6 --tag latest --stage promote --push \
  --verified-report work/n8n-upgrade-2.42.6/server-final/summary.json \
  --log-dir work/n8n-upgrade-2.42.6/server-promote
```

## Rollback and runtime state

The previous images are retained on noam02 under:

- `10.132.134.63:5000/n8n-custom:latest-rollback-20261012084023` — original ID `1fdc68b4835c`.
- `10.132.134.63:5000/n8n-runner-custom:latest-rollback-20261012084023` — original ID `210fdaf9d447`.

These rollback tags are local to the server. Retag and push them to restore the old registry defaults if needed. No running service was recreated in this task; the existing containers still use the previous image IDs.

The new release blocks additions or changes to deprecated nodes by default. Saved workflows can still run them. `N8N_DEPRECATED_NODES_BLOCK=false` supports older imports when needed.
