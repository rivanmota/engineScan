"""
Common interface every technique module implements. A module takes the job
dict (technique_id, target) and returns a result dict matching the API
schema expected by control-plane/src/routes/results.py:

    {"detected": bool | None, "blocked": bool | None, "evidence": str}

`detected`/`blocked` are best-effort, agent-side observations (e.g. "did the
file we wrote disappear"), not a guarantee — the real signal for the
customer is cross-referencing this against their own SIEM/EDR console.
"""

from typing import TypedDict, Optional


class TechniqueResult(TypedDict):
    detected: Optional[bool]
    blocked: Optional[bool]
    evidence: str
