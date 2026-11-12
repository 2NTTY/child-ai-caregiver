#!/usr/bin/env bash
# Operator-only setup for the independent overdue timer. No application data access.
set -euo pipefail
project=ai-caregivers-for-children
region=asia-east2
job=site-overdue-dispatch
bucket=$project-site-release
secret=site-timer-github-app
runner=site-timer-check@$project.iam.gserviceaccount.com
wake=site-timer-wake@$project.iam.gserviceaccount.com
mode=${1:-status}
case "$mode" in
 status)
   gcloud run jobs describe "$job" --project="$project" --region="$region" --format='value(metadata.name)'
   gcloud scheduler jobs describe "$job" --project="$project" --location="$region" --format='table(state,schedule,timeZone,lastAttemptTime)'
   exit ;;
 pause|resume)
   gcloud scheduler jobs "$mode" "$job" --project="$project" --location="$region"
   exit ;;
 install) ;;
 *) echo 'Usage: install-watchdog.sh status|install|pause|resume' >&2; exit 2 ;;
esac

: "${SITE_TIMER_IMAGE:?Set the verified immutable image digest}"
: "${SITE_GITHUB_APP_ID:?Set the GitHub App ID}"
: "${SITE_GITHUB_INSTALLATION_ID:?Set the installation ID for this repository}"
: "${SITE_TIMER_KEY_VERSION:?Set a numeric Secret Manager version}"
[[ "$SITE_TIMER_IMAGE" =~ ^asia-east2-docker\.pkg\.dev/ai-caregivers-for-children/site-release/site-watchdog@sha256:[0-9a-f]{64}$ ]]
for id in "$SITE_GITHUB_APP_ID" "$SITE_GITHUB_INSTALLATION_ID" "$SITE_TIMER_KEY_VERSION"; do [[ "$id" =~ ^[1-9][0-9]*$ ]]; done
gcloud secrets versions describe "$SITE_TIMER_KEY_VERSION" --secret="$secret" --project="$project" --format='value(state)' | grep -qx ENABLED
gcloud artifacts docker images describe "$SITE_TIMER_IMAGE" --project="$project" >/dev/null
for account in site-timer-check site-timer-wake; do
  if ! gcloud iam service-accounts describe "$account@$project.iam.gserviceaccount.com" --project="$project" >/dev/null 2>&1; then
    gcloud iam service-accounts create "$account" --project="$project" --display-name="$account"
  fi
done
gcloud secrets add-iam-policy-binding "$secret" --project="$project" --member="serviceAccount:$runner" --role=roles/secretmanager.secretAccessor --quiet >/dev/null
scope="expression=resource.name.startsWith('projects/_/buckets/$bucket/objects/receipts/watchdog-'),title=website-watchdog-receipts"
for role in roles/storage.objectViewer roles/storage.objectCreator; do
  gcloud storage buckets add-iam-policy-binding "gs://$bucket" --member="serviceAccount:$runner" --role="$role" --condition="$scope" --quiet >/dev/null
done
gcloud run jobs deploy "$job" --project="$project" --region="$region" --image="$SITE_TIMER_IMAGE" \
  --tasks=1 --parallelism=1 --max-retries=0 --task-timeout=2m --cpu=1 --memory=512Mi --service-account="$runner" \
  --set-secrets="/secrets/github-app/private.pem=$secret:$SITE_TIMER_KEY_VERSION" \
  --set-env-vars="SITE_GITHUB_APP_ID=$SITE_GITHUB_APP_ID,SITE_GITHUB_INSTALLATION_ID=$SITE_GITHUB_INSTALLATION_ID" --quiet
gcloud run jobs add-iam-policy-binding "$job" --project="$project" --region="$region" --member="serviceAccount:$wake" --role=roles/run.invoker --quiet >/dev/null
verb=create
if gcloud scheduler jobs describe "$job" --location="$region" --project="$project" >/dev/null 2>&1; then verb=update; fi
gcloud scheduler jobs "$verb" http "$job" --project="$project" --location="$region" --schedule='27 6 * * *' --time-zone=Asia/Hong_Kong \
  --uri="https://run.googleapis.com/v2/projects/$project/locations/$region/jobs/$job:run" --http-method=POST \
  --message-body='{}' --oauth-service-account-email="$wake" --max-retry-attempts=0 --quiet
