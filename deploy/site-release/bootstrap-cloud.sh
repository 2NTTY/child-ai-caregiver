#!/usr/bin/env bash
# Operator-only bootstrap. This file is never invoked by GitHub Actions.
# preflight reads configuration; apply requires the exact reviewed authorization.
# GitHub jobs MUST declare environment: site-publish or site-observe. The OIDC
# environment claim is mapped directly, independently of the mutable sub format.
# Sources checked 2026-11-12:
# https://docs.github.com/en/actions/reference/security/oidc
# https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines
# https://docs.cloud.google.com/storage/docs/json_api/v1/objects/insert
# https://docs.cloud.google.com/firestore/native/docs/manage-databases
set +x
set -euo pipefail
umask 077
export CLOUDSDK_CORE_LOG_HTTP=false

readonly PROJECT=ai-caregivers-for-children
readonly NUMBER=1064034424208
readonly REGION=asia-east2
readonly BUCKET=ai-caregivers-for-children-site-release
readonly REPOSITORY=site-release
readonly POOL=github-site-release
readonly PROVIDER=github
readonly VM=yuban-p1
readonly ZONE=asia-east2-a
readonly VM_SA="yuban-p1@${PROJECT}.iam.gserviceaccount.com"
readonly PUBLISHER="site-publisher@${PROJECT}.iam.gserviceaccount.com"
readonly OBSERVER="site-observer@${PROJECT}.iam.gserviceaccount.com"
readonly DATABASE=yuban-firebase-20261011
readonly AUTHORIZATION="${PROJECT}:site-release:bucket-registry-wif-scoped-iam"
readonly WIF="projects/${NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}"
readonly MAPPING='google.subject=assertion.sub,attribute.environment=assertion.environment,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id'
readonly TRUST="assertion.repository_id=='1377602504' && assertion.repository_owner_id=='119132090' && assertion.workflow_ref=='2NTTY/child-ai-caregiver/.github/workflows/site-release.yml@refs/heads/master' && assertion.ref=='refs/heads/master' && assertion.event_name in ['schedule','workflow_dispatch'] && assertion.runner_environment=='github-hosted' && assertion.environment in ['site-publish','site-observe']"

die() { printf '%s\n' "$*" >&2; exit 1; }
gc() { gcloud --project="$PROJECT" --quiet --verbosity=error "$@" | tr -d '\r'; }
mode=${1:-preflight}
case "$mode" in
  preflight) [[ $# -le 1 ]] || die 'Usage: bootstrap-cloud.sh preflight' ;;
  apply) [[ $# == 3 && $2 == --authorize && $3 == "$AUTHORIZATION" ]] || die "Apply requires explicit human authorization: apply --authorize '${AUTHORIZATION}'" ;;
  *) die 'Usage: bootstrap-cloud.sh preflight | apply --authorize EXACT_AUTHORIZATION' ;;
esac
[[ ${GITHUB_ACTIONS:-false} != true ]] || die 'Bootstrap cannot run in GitHub Actions'
command -v gcloud >/dev/null || die 'Install Google Cloud CLI first'
readonly PYTHON_BIN=${CLOUDSDK_PYTHON:-python3}
command -v "$PYTHON_BIN" >/dev/null || die 'Python 3 is required'
account=$(gc auth list --filter=status:ACTIVE --format='value(account)')
[[ -n $account && $account != *gserviceaccount.com && $account != *$'\n'* ]] || die 'Use one explicitly authenticated human operator account'
impersonation=$(gc config get-value auth/impersonate_service_account 2>/dev/null)
[[ -z $impersonation || $impersonation == '(unset)' ]] || die 'Clear service account impersonation before operator bootstrap'
[[ $(gc projects describe "$PROJECT" --format='value(projectNumber)') == "$NUMBER" ]] || die 'Project number mismatch'

# Keep raw resource and policy JSON local. Print only validation results.
validate() {
  local kind=$1 data=$2
  printf '%s' "$data" | "$PYTHON_BIN" -c '
import json, sys
kind = sys.argv[1]
try:
    obj = json.load(sys.stdin)
    if kind == "bucket":
        assert str(obj["projectNumber"]) == "1064034424208"
        assert obj["location"].upper() == "ASIA-EAST2"
        assert obj["iamConfiguration"]["uniformBucketLevelAccess"]["enabled"] is True
        assert obj["iamConfiguration"]["publicAccessPrevention"] == "enforced"
    elif kind == "registry":
        assert obj["format"] == "DOCKER"
        assert obj["name"] == "projects/ai-caregivers-for-children/locations/asia-east2/repositories/site-release"
        assert obj.get("mode", "STANDARD_REPOSITORY") == "STANDARD_REPOSITORY"
        assert obj.get("dockerConfig", {}).get("immutableTags") is True
    elif kind == "vm":
        services = obj["serviceAccounts"]
        assert len(services) == 1 and services[0]["email"] == "yuban-p1@ai-caregivers-for-children.iam.gserviceaccount.com"
        # IAM alone does not override VM OAuth scopes. Do not change the VM.
        assert "https://www.googleapis.com/auth/cloud-platform" in services[0]["scopes"]
    elif kind == "pool":
        assert obj["state"] == "ACTIVE" and not obj.get("disabled", False)
    elif kind == "providers":
        assert all(p["name"].endswith("/providers/github") for p in obj)
    elif kind == "provider":
        assert obj["state"] == "ACTIVE" and not obj.get("disabled", False)
        assert obj["oidc"]["issuerUri"] == "https://token.actions.githubusercontent.com"
        assert not obj["oidc"].get("allowedAudiences", [])
        assert not obj["oidc"].get("jwksJson")
        assert not obj["oidc"].get("discoveryUri")
        assert not obj.get("actorProviders")
        assert obj["attributeCondition"] == sys.argv[2]
        assert obj["attributeMapping"] == dict(item.split("=", 1) for item in sys.argv[3].split(","))
    elif kind == "sa-policy":
        # This isolated CI SA must not be impersonatable through another route.
        wanted = sys.argv[2]
        for binding in obj.get("bindings", []):
            assert binding["role"] == "roles/iam.workloadIdentityUser"
            assert binding.get("condition") is None
            assert binding["members"] == [wanted]
    else:
        raise ValueError()
except (AssertionError, KeyError, ValueError, TypeError):
    sys.exit("Preflight validation failed: " + kind)
' "$kind" "${3:-}" "${4:-}"
}

enabled=$(gc services list --enabled --format='value(config.name)')
for service in storage.googleapis.com artifactregistry.googleapis.com iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com compute.googleapis.com firestore.googleapis.com; do
  [[ $'\n'"$enabled"$'\n' == *$'\n'"$service"$'\n'* ]] || die "Required API is not enabled: $service; have an operator review API enablement separately"
done
validate vm "$(gc compute instances describe "$VM" --zone="$ZONE" --format='json(serviceAccounts)')"
gc iam service-accounts describe "$VM_SA" --format='value(email)' >/dev/null

bucket_exists=false
if bucket_json=$(gc storage buckets describe "gs://$BUCKET" --raw --format=json 2>/dev/null); then
  validate bucket "$bucket_json"
  bucket_exists=true
fi
registry_exists=false
if registry_json=$(gc artifacts repositories describe "$REPOSITORY" --location="$REGION" --format=json 2>/dev/null); then
  validate registry "$registry_json"
  registry_exists=true
fi
pool_exists=false
if pool_json=$(gc iam workload-identity-pools describe "$POOL" --location=global --format=json 2>/dev/null); then
  validate pool "$pool_json"
  validate providers "$(gc iam workload-identity-pools providers list --workload-identity-pool="$POOL" --location=global --format=json)"
  pool_exists=true
fi
provider_exists=false
if [[ $pool_exists == true ]] && provider_json=$(gc iam workload-identity-pools providers describe "$PROVIDER" --workload-identity-pool="$POOL" --location=global --format=json 2>/dev/null); then
  validate provider "$provider_json" "$TRUST" "$MAPPING"
  provider_exists=true
fi

principal() { printf 'principalSet://iam.googleapis.com/projects/%s/locations/global/workloadIdentityPools/%s/attribute.environment/%s' "$NUMBER" "$POOL" "$1"; }
for pair in "site-publisher:site-publish" "site-observer:site-observe"; do
  sa=${pair%%:*}; environment=${pair#*:}
  if gc iam service-accounts describe "${sa}@${PROJECT}.iam.gserviceaccount.com" --format='value(email)' >/dev/null 2>&1; then
    validate sa-policy "$(gc iam service-accounts get-iam-policy "${sa}@${PROJECT}.iam.gserviceaccount.com" --format=json)" "$(principal "$environment")"
  fi
done

printf 'Preflight passed: project, VM identity/OAuth scope, available release resources, isolated trust identities.\n'
printf 'WIF_PROVIDER=%s\nPUBLISHER=%s\nOBSERVER=%s\n' "$WIF" "$PUBLISHER" "$OBSERVER"
printf 'OIDC environment claim: job environment site-publish / site-observe; exact repository IDs, workflow, master, hosted runner, schedule/dispatch only.\n'
printf 'Plan: private Hong Kong bucket; immutable Docker repo; isolated pool/provider; two CI SAs; scoped object, registry, VM-describe and index-read grants.\n'
[[ $mode == apply ]] || exit 0

[[ $bucket_exists == true ]] || gc storage buckets create "gs://$BUCKET" --location="$REGION" --uniform-bucket-level-access --public-access-prevention >/dev/null
[[ $registry_exists == true ]] || gc artifacts repositories create "$REPOSITORY" --location="$REGION" --repository-format=docker --immutable-tags --description='Isolated site release images' >/dev/null
[[ $pool_exists == true ]] || gc iam workload-identity-pools create "$POOL" --location=global --display-name='Official site release only' >/dev/null
if [[ $provider_exists != true ]]; then
  gc iam workload-identity-pools providers create-oidc "$PROVIDER" --workload-identity-pool="$POOL" --location=global --issuer-uri=https://token.actions.githubusercontent.com --attribute-mapping="$MAPPING" --attribute-condition="$TRUST" >/dev/null
fi

# Custom roles have no object-list, business data, SSH, IAM, VM lifecycle or
# administrative permissions. Object overwrite requires BOTH create and delete.
role() {
  local name=$1 permissions=$2
  if gc iam roles describe "$name" --format='value(name)' >/dev/null 2>&1; then
    gc iam roles update "$name" --permissions="$permissions" --stage=GA >/dev/null
  else
    gc iam roles create "$name" --title="$name" --permissions="$permissions" --stage=GA >/dev/null
  fi
}
role siteReleaseObjectRead storage.objects.get
role siteReleaseObjectWrite storage.objects.create,storage.objects.delete
role siteReleaseVmDescribe compute.instances.get
role siteReleaseIndexRead datastore.indexes.get,datastore.indexes.list
for sa in site-publisher site-observer; do
  if ! gc iam service-accounts describe "${sa}@${PROJECT}.iam.gserviceaccount.com" --format='value(email)' >/dev/null 2>&1; then
    gc iam service-accounts create "$sa" --display-name="$sa" >/dev/null
  fi
done
gc iam service-accounts add-iam-policy-binding "$PUBLISHER" --role=roles/iam.workloadIdentityUser --member="$(principal site-publish)" >/dev/null
gc iam service-accounts add-iam-policy-binding "$OBSERVER" --role=roles/iam.workloadIdentityUser --member="$(principal site-observe)" >/dev/null

readonly BASE="projects/_/buckets/${BUCKET}/objects/"
readonly COMMAND="(resource.name=='${BASE}commands/current.json' || resource.name=='${BASE}control/mode.json')"
readonly RESULTS="(resource.name.startsWith('${BASE}receipts/') || resource.name=='${BASE}status/live.json')"
bucket_grant() {
  gc storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$1" --role="projects/${PROJECT}/roles/$2" --condition="title=$3,expression=resource.type=='storage.googleapis.com/Object' && $4" >/dev/null
}
bucket_grant "$PUBLISHER" siteReleaseObjectRead site-publisher-read "($COMMAND || $RESULTS)"
bucket_grant "$PUBLISHER" siteReleaseObjectWrite site-publisher-write "$COMMAND"
bucket_grant "$OBSERVER" siteReleaseObjectRead site-observer-read "($COMMAND || $RESULTS)"
bucket_grant "$VM_SA" siteReleaseObjectRead site-vm-read "($COMMAND || $RESULTS)"
bucket_grant "$VM_SA" siteReleaseObjectWrite site-vm-write "$RESULTS"
gc artifacts repositories add-iam-policy-binding "$REPOSITORY" --location="$REGION" --member="serviceAccount:$PUBLISHER" --role=roles/artifactregistry.writer >/dev/null
gc artifacts repositories add-iam-policy-binding "$REPOSITORY" --location="$REGION" --member="serviceAccount:$VM_SA" --role=roles/artifactregistry.reader >/dev/null
gc compute instances add-iam-policy-binding "$VM" --zone="$ZONE" --member="serviceAccount:$OBSERVER" --role="projects/${PROJECT}/roles/siteReleaseVmDescribe" >/dev/null
gc projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$OBSERVER" --role="projects/${PROJECT}/roles/siteReleaseIndexRead" --condition="title=site-observer-indexes,expression=resource.name=='projects/${PROJECT}/databases/${DATABASE}'" >/dev/null
printf 'Scoped bootstrap commands completed. No VM lifecycle, SSH, business data, key, or CI administration grants were issued.\n'
