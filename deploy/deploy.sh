#!/bin/sh
# Deploy Pixel Plot to Cloud Run (multi-container: app + litestream sidecar).
# Prereq: image pushed to the AR repo referenced in deploy/service.yml.
set -eu
cd "$(dirname "$0")/.."

PROJECT=pixel-plot-2026
REGION=us-central1

# Preferred path: gcloud (needs a recent SDK for multi-container YAML).
if gcloud run services replace deploy/service.yml --project="$PROJECT" --region="$REGION" --quiet; then
	echo "deployed via gcloud"
else
	echo "gcloud path failed; falling back to REST"
	TOKEN=$(gcloud auth print-access-token --quiet)
	python3 - "$TOKEN" <<'PY'
import json, sys, urllib.request, yaml
token = sys.argv[1]
body = json.dumps(yaml.safe_load(open("deploy/service.yml"))).encode()
req = urllib.request.Request(
	"https://run.googleapis.com/v2/namespaces/pixel-plot-2026/locations/us-central1/services",
	data=body,
	headers={"Authorization": f"Bearer {token}", "content-type": "application/json"},
	method="POST",
)
print(urllib.request.urlopen(req).read().decode()[:400])
PY
fi
