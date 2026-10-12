# Memory

## 2026-10-12: Upgrade a release fork

- A compare link does not identify the installed source version. Read the root and CLI manifests first.
- This fork had two local commits on 2.34.6. The requested release was 2.42.6.
- Release branches can diverge through backports. A normal merge can retain old release files or create conflicts unrelated to local changes.
- Compare the result with the exact target tag. Keep differences only in the declared local files and delivery documents.
- Save local changes as a patch before the upgrade. Keep a backup ref until the new version is verified.
- Docker stage names and native build layouts can change between releases. Apply local mirror settings to the new stages.
- Component versions can differ from the root release version. Compare each manifest with the target tag.
- Node installers do not automatically use macOS proxy settings. Pass the configured proxy through `HTTP_PROXY` and `HTTPS_PROXY` when GitHub downloads fail.
- A failed ripgrep installer can leave an empty `bin/` directory. A retry can skip the download because that directory exists. Verify the binary and the official archive digest before the retry.
- The user expects final custom n8n images to be built on `noam02`. A local source upgrade and local build are intermediate checks.
