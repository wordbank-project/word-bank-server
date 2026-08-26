#!/usr/bin/env bash
# Redeploys word-bank-server to the Raspberry Pi after a code change: pulls
# the latest commit, rebuilds the Docker image, and replaces the running
# container with a fresh one from that image.
#
# Unlike wiktapi's deploy_to_pi.sh (a data-only file swap + restart), a code
# change needs a full rebuild — restarting the existing container alone
# would just re-run the old image. `docker rm -f` + a fresh `docker run` is
# what actually picks up the new image; the named volume (words-data)
# persists across this untouched, so saved words survive.
#
# Usage: ./scripts/redeploy_to_pi.sh [pi-host]
# Example: ./scripts/redeploy_to_pi.sh pi@raspberrypi.local
#
# GROQ_API_KEY / CEREBRAS_API_KEY are read from this repo's own .env (never
# hardcoded here, so this script is safe to commit). ALLOWED_ORIGIN and the
# rate limits below match the LAN-testing setup currently in deployment.md —
# override any of them via env vars if your setup differs, e.g.:
#   ALLOWED_ORIGIN=https://word-bank-vault.netlify.app ./scripts/redeploy_to_pi.sh

set -euo pipefail

PI_HOST="${1:-pi@raspberrypi.local}"
REMOTE_DIR="${REMOTE_DIR:-~/word-bank-server}"
CONTAINER_NAME="${CONTAINER_NAME:-word-bank}"

# Always run from the repo root, regardless of where this script is invoked from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [[ -z "${GROQ_API_KEY:-}" ]]; then
  echo "GROQ_API_KEY not set — add it to .env first (see .env.example)." >&2
  exit 1
fi

ALLOWED_ORIGIN="${ALLOWED_ORIGIN:-https://word-bank-vault.netlify.app,http://localhost:8081}"
ANALYZE_PER_MINUTE="${ANALYZE_PER_MINUTE:-10}"
WORDS_PER_MINUTE="${WORDS_PER_MINUTE:-30}"

echo "==> Pulling latest code on $PI_HOST..."
ssh "$PI_HOST" "cd $REMOTE_DIR && git pull"

echo "==> Building new image on $PI_HOST..."
ssh "$PI_HOST" "cd $REMOTE_DIR && docker build -t word-bank-server ."

echo "==> Removing old container (if any)..."
ssh "$PI_HOST" "docker rm -f $CONTAINER_NAME" || true

echo "==> Starting new container..."
ssh "$PI_HOST" "docker run -d --name $CONTAINER_NAME --restart unless-stopped \
  --log-opt max-size=10m --log-opt max-file=3 \
  -p 4000:4000 -v words-data:/app/data \
  -e PORT=4000 \
  -e ALLOWED_ORIGIN=$ALLOWED_ORIGIN \
  -e GROQ_API_KEY=$GROQ_API_KEY \
  -e CEREBRAS_API_KEY=${CEREBRAS_API_KEY:-} \
  -e ANALYZE_PER_MINUTE=$ANALYZE_PER_MINUTE -e WORDS_PER_MINUTE=$WORDS_PER_MINUTE \
  word-bank-server"

echo "==> Waiting for the server to come up..."
# `docker run -d` returns as soon as the container starts, not once Node is
# actually listening — retry the health check for a few seconds instead of
# checking once immediately, which can race a slow cold start (especially on
# a Pi) and report a false failure even though the container is fine.
HEALTHY=false
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if ssh "$PI_HOST" 'curl -sf "http://localhost:4000/v1"' > /tmp/redeploy_health_check.json 2>/dev/null; then
    HEALTHY=true
    break
  fi
  sleep 1
done

if [[ "$HEALTHY" != true ]]; then
  echo "Server did not respond on /v1 after 10 seconds — check the container:" >&2
  echo "  ssh $PI_HOST 'docker ps -a | grep $CONTAINER_NAME; docker logs $CONTAINER_NAME --tail 50'" >&2
  exit 1
fi

echo "==> Healthy:"
cat /tmp/redeploy_health_check.json
echo
echo "==> Done. To also confirm AI suggestions are working:"
echo "    curl \"http://localhost:4000/v1/suggestions?lang=nl\""
