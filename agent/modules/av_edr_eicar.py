"""
AV/EDR detection test (technique id: AVTEST-EICAR).

Writes the official EICAR antivirus test file — a standard, publicly
documented string that every antivirus vendor recognizes and treats as a
test signature. It is not malware and contains no executable payload; its
only purpose, industry-wide, is to verify that AV/EDR scanning is active.
See https://www.eicar.org/ for the standard.

The test: write the file, wait briefly, check whether it still exists
unmodified. If AV/EDR is working, the file is typically quarantined or
deleted within seconds.
"""

import os
import tempfile
import time

from .base import TechniqueResult

# The official EICAR test string, unmodified, per the published standard.
EICAR_STRING = (
    r"X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"
)


def run(job: dict) -> TechniqueResult:
    test_dir = tempfile.gettempdir()
    test_path = os.path.join(test_dir, "stubengine-av-test.com")

    try:
        with open(test_path, "w") as f:
            f.write(EICAR_STRING)
    except OSError as e:
        # Write itself was blocked — that's a strong positive detection signal.
        return {
            "detected": True,
            "blocked": True,
            "evidence": f"Write to disk was blocked before the file could be created: {e}",
        }

    time.sleep(3)  # give AV/EDR real-time scanning a moment to react

    still_present = os.path.exists(test_path)
    if still_present:
        try:
            os.remove(test_path)
        except OSError:
            pass  # if AV has a lock on it, that's itself a detection signal
        return {
            "detected": False,
            "blocked": False,
            "evidence": "EICAR test file was not removed or quarantined within 3s.",
        }

    return {
        "detected": True,
        "blocked": True,
        "evidence": "EICAR test file was removed/quarantined — AV/EDR is active.",
    }
