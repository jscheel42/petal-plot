#!/bin/sh
# Deploy Pixel Plot to Cloud Run (multi-container: app + litestream sidecar).
# Prereq: image pushed to the repo referenced in deploy/service.json:
#   docker buildx build --platform linux/amd64 \
#     -t us-central1-docker.pkg.dev/pixel-plot-2026/pixel-plot/app:latest --push .
set -eu
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:$PATH"  # homebrew SDK; the ~/bin copy is stale
PROJECT=pixel-plot-2026
REGION=us-central1
TOKEN=$(gcloud auth print-access-token --quiet)

curl -sS -X POST \
	"https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services?serviceId=pixel-plot" \
	-H "Authorization: Bearer ${TOKEN}" \
	-H "content-type: application/json" \
	--data-binary @deploy/service.json | head -c 500
echo
