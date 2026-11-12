"""
Simulated C2 beacon test (technique id: T1071 — Application Layer Protocol).

Sends a single, clearly-tagged HTTP GET request to infrastructure the
*operator of this product* controls (configured via BEACON_SINKHOLE_URL,
never a customer-supplied or third-party address). No payload is sent and
no response is executed — this purely tests whether the customer's own
egress filtering, proxy, or SIEM would flag outbound traffic shaped like a
C2 beacon (unusual User-Agent, fixed-interval request pattern, uncommon
destination).

Because the destination is infrastructure you operate and control, no real
attacker ever receives anything — the "attack" never leaves your own
product's boundary.
"""

import os

import requests

from .base import TechniqueResult

DEFAULT_SINKHOLE = "https://beacon.stubengine.com/sink"  # operator-controlled receiver


def run(job: dict) -> TechniqueResult:
    sinkhole_url = os.environ.get("BEACON_SINKHOLE_URL", DEFAULT_SINKHOLE)
    headers = {
        "User-Agent": "StubEngine-BAS-Beacon/1.0 (simulated-c2-test)",
        "X-StubEngine-Job-Id": job.get("id", "unknown"),
    }

    try:
        resp = requests.get(sinkhole_url, headers=headers, timeout=5)
        return {
            "detected": None,  # agent can't see the customer's firewall/SIEM logs
            "blocked": False,
            "evidence": (
                f"Beacon request reached {sinkhole_url} (status {resp.status_code}). "
                "Check the customer's egress logs/SIEM to confirm whether this was flagged."
            ),
        }
    except requests.exceptions.RequestException as e:
        return {
            "detected": True,
            "blocked": True,
            "evidence": f"Beacon request was blocked or failed to reach the sinkhole: {e}",
        }
