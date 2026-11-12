"""
Endpoint agent: polls the control plane for jobs scoped to this agent,
runs the matching technique module, and posts the result back.

Usage:
    python agent.py --control-plane https://control.example.com --agent-token <token>

The agent trusts the control plane's scope enforcement (see
control-plane/src/lib/scope.ts) — it does not re-validate that a job is
"allowed", it only executes the technique module for whatever job it's
handed. This is an intentional separation: scope policy lives in one place
(the control plane, which the customer's security team interacts with),
not duplicated and potentially drifted across every installed agent.
"""

import argparse
import time

import requests

from modules import av_edr_eicar, c2_beacon, port_scan

MODULES = {
    "AVTEST-EICAR": av_edr_eicar,
    "T1071": c2_beacon,
    "T1046": port_scan,
}

POLL_INTERVAL_SECONDS = 10


def poll_and_run(control_plane: str, agent_token: str) -> None:
    headers = {"X-Agent-Token": agent_token}

    while True:
        try:
            resp = requests.get(f"{control_plane}/agents/jobs", headers=headers, timeout=10)
            resp.raise_for_status()
            jobs = resp.json()
        except requests.exceptions.RequestException as e:
            print(f"[agent] failed to fetch jobs: {e}")
            time.sleep(POLL_INTERVAL_SECONDS)
            continue

        for job in jobs:
            technique_id = job["techniqueId"]
            module = MODULES.get(technique_id)
            if module is None:
                print(f"[agent] no module registered for technique {technique_id}, skipping")
                continue

            print(f"[agent] running {technique_id} against {job['target']}")
            try:
                result = module.run({"id": job["id"], "target": job["target"]})
            except Exception as e:  # noqa: BLE001 - a module failure shouldn't crash the poller
                result = {"detected": None, "blocked": None, "evidence": f"Module error: {e}"}

            try:
                requests.post(
                    f"{control_plane}/results",
                    headers=headers,
                    json={"jobId": job["id"], **result},
                    timeout=10,
                )
            except requests.exceptions.RequestException as e:
                print(f"[agent] failed to post result for job {job['id']}: {e}")

        time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--control-plane", required=True, help="Base URL of the control plane API")
    parser.add_argument("--agent-token", required=True, help="Token issued when this agent was registered")
    args = parser.parse_args()

    poll_and_run(args.control_plane.rstrip("/"), args.agent_token)
