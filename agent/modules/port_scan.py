"""
Network service discovery test (technique id: T1046).

Plain TCP-connect scan against a single host — the same host the control
plane already validated against the campaign's declared scope before
creating this job (see control-plane/src/lib/scope.ts). This module does
not re-validate scope; it trusts the job it was given, which is why scope
enforcement living server-side, not client-side, matters.

No exploitation, no banner-grabbing beyond a bare connect/disconnect. The
result tells the customer which commonly-targeted ports are reachable from
wherever this agent sits on their network — useful for spotting
unintentionally exposed services, same as the discovery step a real
attacker would do before picking a target.
"""

import socket

from .base import TechniqueResult

COMMON_PORTS = [21, 22, 23, 25, 80, 139, 443, 445, 3306, 3389, 5432, 6379, 8080]


def run(job: dict) -> TechniqueResult:
    target = job["target"]
    open_ports = []

    for port in COMMON_PORTS:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(1.5)
        try:
            result = sock.connect_ex((target, port))
            if result == 0:
                open_ports.append(port)
        except socket.error:
            pass
        finally:
            sock.close()

    return {
        "detected": None,  # a scan being "detected" depends on the customer's IDS, not this agent
        "blocked": None,
        "evidence": (
            f"Open ports on {target}: {open_ports}"
            if open_ports
            else f"No commonly-scanned ports open on {target}."
        ),
    }
