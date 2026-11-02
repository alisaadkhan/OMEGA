#!/usr/bin/env bash
# Staging worker on Azure Container Apps (owner approval 2026-10-26: Azure for Students, staging only, smallest size).
# NOT YET RUN: the Azure CLI is not installed on this machine and an interactive `az login` is needed. Review each step.
#
#   bash scripts/ops/azure-worker-staging.sh check                 # eligibility and region checks only (no resources)
#   bash scripts/ops/azure-worker-staging.sh deploy <env-file>     # create/update the staging worker
#   bash scripts/ops/azure-worker-staging.sh stop                  # stop it when testing is not active
#   bash scripts/ops/azure-worker-staging.sh usage                 # what it has used
#
# <env-file>: a file YOU write outside the repository (never committed, never printed) with the staging worker's
# variables (docs/readiness/worker-hosting.md). The script refuses production settings and paid provider keys unless
# ALLOW_PAID_PROVIDERS=yes is set for a deliberate, approved test.
set -euo pipefail

RG="${RG:-roster-staging-rg}"
LOCATION="${LOCATION:-southeastasia}"      # choose a region the check step shows as available for Container Apps
ENV_NAME="${ENV_NAME:-roster-staging-env}"
APP="${APP:-roster-worker-staging}"
ACR="${ACR:-rosterstagingacr$RANDOM}"       # a registry name must be globally unique; set ACR to reuse one

need() { command -v "$1" >/dev/null || { echo "Missing $1. Install the Azure CLI, then run: az login" >&2; exit 2; }; }

check() {
  need az
  az account show --query "{subscription:name, state:state, id:id}" -o table
  echo "Offer (should be Azure for Students):"; az account show --query "user" -o table
  az extension add --name containerapp --upgrade --only-show-errors
  echo "Microsoft.App registration:"; az provider show -n Microsoft.App --query registrationState -o tsv
  echo "Regions offering managed environments:"
  az provider show -n Microsoft.App --query "resourceTypes[?resourceType=='managedEnvironments'].locations | [0]" -o tsv
  echo "If Microsoft.App is NotRegistered: az provider register -n Microsoft.App (and Microsoft.ContainerRegistry)."
}

deploy() {
  need az
  local envfile="${1:?usage: deploy <env-file>}"
  [[ -f "$envfile" ]] || { echo "No such file: $envfile" >&2; exit 2; }
  case "$(realpath "$envfile")" in *"/MUSHIN/"*) echo "Keep the env file outside the repository." >&2; exit 2;; esac
  # Safety: staging only, no paid providers, no YouTube API calls.
  if grep -Eq '^NODE_ENV=production' "$envfile"; then echo "Refusing NODE_ENV=production (staging only)." >&2; exit 2; fi
  if [[ "${ALLOW_PAID_PROVIDERS:-no}" != "yes" ]] && grep -Eq '^(APIFY_TOKEN|SERPER_API_KEY|GEMINI_API_KEY|OLLAMA_API_KEY|YOUTUBE_API_KEY)=.+' "$envfile"; then
    echo "Refusing paid provider keys without ALLOW_PAID_PROVIDERS=yes (owner approval needed)." >&2; exit 2
  fi
  if grep -Eq '^YOUTUBE_API_CALLS=on' "$envfile"; then echo "Refusing YOUTUBE_API_CALLS=on (policy decision pending)." >&2; exit 2; fi

  az group create -n "$RG" -l "$LOCATION" -o none
  # Basic registry: the image is built in Azure (no local Docker needed). It is billed from the credit.
  az acr show -n "$ACR" -g "$RG" -o none 2>/dev/null || az acr create -n "$ACR" -g "$RG" --sku Basic --admin-enabled true -o none
  az acr build -r "$ACR" -t roster-worker:staging -f Dockerfile.worker .
  # No Log Analytics workspace (avoids its cost); container logs via `az containerapp logs show`.
  az containerapp env show -n "$ENV_NAME" -g "$RG" -o none 2>/dev/null || az containerapp env create -n "$ENV_NAME" -g "$RG" -l "$LOCATION" --logs-destination none -o none

  # Every variable goes in as a Container Apps secret, referenced by the environment variable of the same name.
  local secrets=() envs=()
  while IFS='=' read -r k v; do
    [[ -z "$k" || "$k" =~ ^# ]] && continue
    local name; name="$(echo "$k" | tr 'A-Z_' 'a-z-')"
    secrets+=("$name=$v"); envs+=("$k=secretref:$name")
  done < "$envfile"
  envs+=("YOUTUBE_API_CALLS=off")
  local server; server="$(az acr show -n "$ACR" --query loginServer -o tsv)"
  if az containerapp show -n "$APP" -g "$RG" -o none 2>/dev/null; then
    az containerapp secret set -n "$APP" -g "$RG" --secrets "${secrets[@]}" -o none
    az containerapp update -n "$APP" -g "$RG" --image "$server/roster-worker:staging" --set-env-vars "${envs[@]}" --min-replicas 1 --max-replicas 1 -o none
  else
    # Smallest size Container Apps allows: 0.25 vCPU, 0.5 GiB; exactly one replica (pg-boss needs a running process).
    az containerapp create -n "$APP" -g "$RG" --environment "$ENV_NAME" --image "$server/roster-worker:staging" \
      --registry-server "$server" --cpu 0.25 --memory 0.5Gi --min-replicas 1 --max-replicas 1 \
      --secrets "${secrets[@]}" --env-vars "${envs[@]}" -o none
  fi
  echo "Deployed. Verify: the staff console worker alert clears within two minutes; az containerapp logs show -n $APP -g $RG"
}

stop() {
  need az
  # Deactivating the active revision stops the replica (no compute billed); `deploy` brings it back.
  local rev; rev="$(az containerapp show -n "$APP" -g "$RG" --query properties.latestRevisionName -o tsv)"
  az containerapp revision deactivate -n "$APP" -g "$RG" --revision "$rev"
  echo "Stopped revision $rev. To remove everything: az group delete -n $RG"
}

usage() {
  need az
  az containerapp show -n "$APP" -g "$RG" --query "{state:properties.runningStatus, replicas:properties.template.scale, cpu:properties.template.containers[0].resources}" -o json
  echo "Costs so far: Azure portal > Cost Management, or: az consumption usage list --top 20 -o table"
}

case "${1:-}" in
  check) check ;;
  deploy) shift; deploy "$@" ;;
  stop) stop ;;
  usage) usage ;;
  *) sed -n '2,13p' "$0"; exit 1 ;;
esac
