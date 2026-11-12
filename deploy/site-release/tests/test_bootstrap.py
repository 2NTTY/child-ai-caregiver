"""Execute bootstrap against a fake gcloud; no Google Cloud connection is used."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
BASH = os.environ.get("SITE_TEST_BASH") or shutil.which("bash")
FAKE = r'''
gcloud() {
  printf '%s\n' "$*" >> "$FAKE_LOG"
  case "$*" in
    *'auth list'*) printf '%s\n' 'operator@example.invalid' ;;
    *'config get-value'*) printf '%s\n' '(unset)' ;;
    *'projects describe'*) printf '%s\n' '1064034424208' ;;
    *'services list'*) printf '%s\n' storage.googleapis.com artifactregistry.googleapis.com iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com compute.googleapis.com firestore.googleapis.com ;;
    *'compute instances describe'*)
      if [[ ${FAKE_VM_BAD:-0} == 1 ]]; then printf '{}'; else
      printf '%s' '{"serviceAccounts":[{"email":"yuban-p1@ai-caregivers-for-children.iam.gserviceaccount.com","scopes":["https://www.googleapis.com/auth/cloud-platform"]}]}'; fi ;;
    *'storage buckets describe'*)
      [[ ${FAKE_EXISTING:-0} == 1 ]] || return 1
      printf '%s' '{"projectNumber":"1064034424208","location":"ASIA-EAST2","iamConfiguration":{"uniformBucketLevelAccess":{"enabled":true},"publicAccessPrevention":"enforced"}}' ;;
    *'artifacts repositories describe'*)
      [[ ${FAKE_EXISTING:-0} == 1 ]] || return 1
      printf '%s' '{"name":"projects/ai-caregivers-for-children/locations/asia-east2/repositories/site-release","format":"DOCKER","dockerConfig":{"immutableTags":true}}' ;;
    *'workload-identity-pools describe'*)
      [[ ${FAKE_POOL:-0} == 1 ]] || return 1
      printf '%s' '{"state":"ACTIVE"}' ;;
    *'workload-identity-pools providers list'*) printf '%s' '[{"name":"projects/1064034424208/locations/global/workloadIdentityPools/github-site-release/providers/github"}]' ;;
    *'workload-identity-pools providers describe'*)
      if [[ ${FAKE_PROVIDER_GOOD:-0} == 1 ]]; then
        printf '{"state":"ACTIVE","oidc":{"issuerUri":"https://token.actions.githubusercontent.com"},"attributeCondition":"%s","attributeMapping":{"google.subject":"assertion.sub","attribute.environment":"assertion.environment","attribute.repository_id":"assertion.repository_id","attribute.repository_owner_id":"assertion.repository_owner_id"}}' "$TRUST"
      else
        printf '%s' '{"state":"ACTIVE","oidc":{"issuerUri":"https://token.actions.githubusercontent.com"},"attributeCondition":"true","attributeMapping":{"google.subject":"assertion.sub"}}'
      fi ;;
    *'iam roles describe'*) return 1 ;;
    *'iam service-accounts describe yuban-p1@'*) printf '%s\n' 'yuban-p1@ai-caregivers-for-children.iam.gserviceaccount.com' ;;
    *'iam service-accounts describe'*) return 1 ;;
    *) return 0 ;;
  esac
}
export -f gcloud
source "$1" "${@:2}"
'''


@unittest.skipUnless(BASH, "Bash is required for offline bootstrap tests")
class BootstrapTests(unittest.TestCase):
    def run_bootstrap(self, *args, **extra):
        with tempfile.TemporaryDirectory(dir=ROOT) as folder:
            log = Path(folder) / "calls.txt"
            env = {**os.environ, "FAKE_LOG": log.as_posix(), **extra}
            # Git Bash must see Python 3 through a real executable on Windows.
            import sys
            if os.name == "nt":
                shim = Path(folder) / "python3"
                python = Path(sys.executable).as_posix()
                shim.write_text('#!/usr/bin/env bash\nexec "' + python + '" "$@"\n', encoding="utf-8")
                env["PATH"] = str(Path(folder)) + os.pathsep + env["PATH"]
            result = subprocess.run([BASH, "-c", FAKE, "offline-test", (ROOT / "bootstrap-cloud.sh").as_posix(), *args], env=env, text=True, capture_output=True, timeout=30)
            calls = log.read_text().splitlines() if log.exists() else []
            return result, calls

    def test_preflight_never_mutates(self):
        result, calls = self.run_bootstrap("preflight")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("WIF_PROVIDER=projects/1064034424208/locations/global/workloadIdentityPools/github-site-release/providers/github", result.stdout)
        self.assertFalse(any(any(word in call for word in (" create ", " update ", "add-iam-policy-binding")) for call in calls))

    def test_apply_without_exact_authorization_never_calls_gcloud(self):
        result, calls = self.run_bootstrap("apply")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls, [])

    def test_ci_cannot_bootstrap_even_with_authorization(self):
        result, calls = self.run_bootstrap("apply", "--authorize", "ai-caregivers-for-children:site-release:bucket-registry-wif-scoped-iam", GITHUB_ACTIONS="true")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls, [])

    def test_wrong_vm_identity_fails_before_mutation(self):
        result, calls = self.run_bootstrap("apply", "--authorize", "ai-caregivers-for-children:site-release:bucket-registry-wif-scoped-iam", FAKE_VM_BAD="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(" create " in call or "add-iam-policy-binding" in call for call in calls))

    def test_apply_creates_isolated_resources_and_separates_grants(self):
        result, calls = self.run_bootstrap("apply", "--authorize", "ai-caregivers-for-children:site-release:bucket-registry-wif-scoped-iam")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(any("storage buckets create" in c and "--public-access-prevention" in c and "--location=asia-east2" in c for c in calls))
        self.assertTrue(any("artifacts repositories create" in c and "--immutable-tags" in c for c in calls))
        trust = next(c for c in calls if "providers create-oidc" in c)
        for requirement in ("assertion.repository_id=='1377602504'", "assertion.repository_owner_id=='119132090'", ".github/workflows/site-release.yml@refs/heads/master", "assertion.environment in ['site-publish','site-observe']", "assertion.runner_environment=='github-hosted'", "assertion.event_name in ['schedule','workflow_dispatch']"):
            self.assertIn(requirement, trust)
        observer = [c for c in calls if "--member=serviceAccount:site-observer@" in c]
        self.assertEqual(len(observer), 3)
        self.assertFalse(any("ObjectWrite" in c or "artifacts" in c for c in observer))
        self.assertTrue(any("compute instances add-iam-policy-binding yuban-p1" in c and "siteReleaseVmDescribe" in c for c in observer))
        self.assertTrue(any("siteReleaseIndexRead" in c and "resource.name=='projects/ai-caregivers-for-children/databases/yuban-firebase-20261011'" in c for c in observer))
        writes = [c for c in calls if "storage buckets add-iam-policy-binding" in c and "siteReleaseObjectWrite" in c]
        self.assertEqual(len(writes), 2)
        pub = next(c for c in writes if "site-publisher@" in c)
        self.assertIn("commands/current.json", pub)
        self.assertIn("control/mode.json", pub)
        self.assertNotIn("receipts/", pub)
        vm = next(c for c in writes if "yuban-p1@" in c)
        self.assertIn("receipts/", vm)
        self.assertIn("status/live.json", vm)
        self.assertNotIn("commands/", vm)
        self.assertFalse(any("roles/owner" in c or "roles/editor" in c or "roles/compute.admin" in c or "storage.objects.list" in c or "datastore.entities" in c for c in calls))

    def test_existing_bucket_and_registry_are_not_recreated(self):
        result, calls = self.run_bootstrap("apply", "--authorize", "ai-caregivers-for-children:site-release:bucket-registry-wif-scoped-iam", FAKE_EXISTING="1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(any("storage buckets create" in c or "artifacts repositories create" in c for c in calls))

    def test_existing_broad_provider_is_rejected_before_granting_access(self):
        result, calls = self.run_bootstrap("apply", "--authorize", "ai-caregivers-for-children:site-release:bucket-registry-wif-scoped-iam", FAKE_POOL="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(" create " in c or " update " in c or "add-iam-policy-binding" in c for c in calls))

    def test_existing_exact_provider_is_preserved(self):
        result, calls = self.run_bootstrap("apply", "--authorize", "ai-caregivers-for-children:site-release:bucket-registry-wif-scoped-iam", FAKE_POOL="1", FAKE_PROVIDER_GOOD="1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(any("providers create-oidc" in c or "providers update-oidc" in c or "workload-identity-pools create" in c for c in calls))


if __name__ == "__main__":
    unittest.main()
