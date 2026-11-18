"""Print the platform embedding quota observed with the operator's current gcloud session."""
import argparse
import datetime
import http.client
import json
import re
import subprocess
from urllib.parse import quote


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True)
    parser.add_argument("--gcloud", default="gcloud")
    parser.add_argument("--predict-region", help="Also check the shared predict bucket for the site's Vertex location")
    args = parser.parse_args()
    if not re.fullmatch(r"[a-z][a-z0-9-]{4,28}[a-z0-9]", args.project):
        parser.error("Expected a Google Cloud project ID")
    if args.predict_region and not re.fullmatch(r"global|us|eu|[a-z]+(?:-[a-z]+)+[0-9]", args.predict_region):
        parser.error("Expected a Vertex location")

    def gcloud(*argv):
        return subprocess.check_output([args.gcloud, *argv], text=True, timeout=45).strip()

    number = gcloud("projects", "describe", args.project, "--format=value(projectNumber)")
    if not number.isdigit():
        raise SystemExit("Expected a project number")
    headers = {"Authorization": "Bearer " + gcloud("auth", "print-access-token", "--quiet"), "x-goog-user-project": args.project}
    timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    observations = []

    def read_limits(metric):
        path = f"/v1beta1/projects/{number}/services/aiplatform.googleapis.com/consumerQuotaMetrics/{quote(metric, safe='')}?view=FULL"
        connection = http.client.HTTPSConnection("serviceusage.googleapis.com", timeout=15)
        try:
            connection.request("GET", path, headers=headers)
            response = connection.getresponse()
            if response.status != 200:
                raise SystemExit(f"Service Usage returned HTTP {response.status} for {metric}")
            data = json.load(response)
        finally:
            connection.close()
        if data.get("metric") != metric:
            raise SystemExit("Unexpected quota metric")
        return data.get("consumerQuotaLimits", [])

    def append_observation(metric, unit, model, tier, limits):
        if len(limits) > 1:
            raise SystemExit(f"Conflicting {unit} buckets")
        value = next(iter(limits), "")
        if value.isdecimal():
            observations.append({"provider": "Vertex AI", "project": args.project, "model": model,
                                 "tier": tier, "source": metric,
                                 "observedAt": timestamp, "unit": unit, "limit": int(value)})

    for dimension, unit in (("requests", "RPM"), ("input_tokens", "TPM")):
        metric = f"aiplatform.googleapis.com/global_embed_content_{dimension}_per_minute_per_base_model"
        limits = {str(b.get("effectiveLimit")) for limit in read_limits(metric)
                  if limit.get("unit") == "1/min/{project}/{base_model}" for b in limit.get("quotaBuckets", [])
                  if b.get("dimensions") == {"base_model": "gemini-embedding"}}
        append_observation(metric, unit, "gemini-embedding-001", "global / base_model=gemini-embedding", limits)
    if args.predict_region:
        metric = "aiplatform.googleapis.com/online_prediction_requests"
        buckets = [b for limit in read_limits(metric) if limit.get("unit") == "1/min/{project}/{region}"
                   for b in limit.get("quotaBuckets", [])]
        selected = [b for b in buckets if b.get("dimensions") == {"region": args.predict_region}]
        if not selected:
            selected = [b for b in buckets if not b.get("dimensions")]
        append_observation(metric, "RPM", "Vertex predict（模型共用）", args.predict_region + " / 每專案每區",
                           {str(b.get("effectiveLimit")) for b in selected})
    if not observations:
        raise SystemExit("No applicable finite effective quota returned")
    print(json.dumps({"day": timestamp[:10], "observedAt": timestamp, "providerQuota": observations}))


if __name__ == "__main__":
    main()
