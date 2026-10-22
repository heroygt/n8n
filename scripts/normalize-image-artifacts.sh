#!/bin/sh
# Keep cached public assets readable by the image user.
set -eu
artifact_root="${1:?Usage: normalize-image-artifacts.sh ROOT}"
for relative in compiled dist/task-runner-javascript docker/images; do
    artifact_path="$artifact_root/$relative"
    if [ ! -d "$artifact_path" ]; then
        echo "FAIL: missing public artifact directory: $relative" >&2
        exit 1
    fi
    chmod -R a+rX "$artifact_path"
done
echo "SUCCESS: public image artifact permissions"
