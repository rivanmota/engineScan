// Registry of techniques this product is allowed to run. Every module in
// agent/modules/ must have a corresponding entry here with matching id.
// Adding a technique to this product means reading docs/SAFETY_AND_SCOPE.md
// first — not every MITRE ATT&CK technique belongs in a self-serve product.

export interface TechniqueDefinition {
  id: string; // MITRE ATT&CK technique ID
  name: string;
  description: string;
  module: string; // filename in agent/modules/ (without .py)
  requiresTarget: boolean; // true if this technique needs a specific host/CIDR from scope
}

export const TECHNIQUES: Record<string, TechniqueDefinition> = {
  T1046: {
    id: "T1046",
    name: "Network Service Discovery",
    description:
      "TCP-connect scan of common ports against explicitly scoped hosts. No exploitation.",
    module: "port_scan",
    requiresTarget: true,
  },
  T1071: {
    id: "T1071",
    name: "Application Layer Protocol (simulated C2 beacon)",
    description:
      "Sends a tagged outbound HTTP request to operator-controlled infrastructure to test egress monitoring and alerting.",
    module: "c2_beacon",
    requiresTarget: false,
  },
  "AVTEST-EICAR": {
    id: "AVTEST-EICAR",
    name: "AV/EDR Detection Test",
    description:
      "Writes the official EICAR antivirus test string to disk and checks whether it's quarantined or removed.",
    module: "av_edr_eicar",
    requiresTarget: false,
  },
};

export function isKnownTechnique(id: string): boolean {
  return id in TECHNIQUES;
}
