import { NextRequest } from "next/server";
import { getDb } from "./firestore";
import { Agent, ApiKey } from "@/types/firestore";

// Minimal scaffold auth: swap for a real session/JWT system before launch.
// Every request from the dashboard/API consumer carries X-Api-Key.

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

export async function requireOrgApiKey(req: NextRequest): Promise<{ organizationId: string }> {
  const key = req.headers.get("X-Api-Key");
  if (!key) throw new AuthError("Missing X-Api-Key header");

  const snapshot = await getDb().collection("apiKeys").where("key", "==", key).limit(1).get();
  if (snapshot.empty) throw new AuthError("Invalid API key");

  const apiKey = snapshot.docs[0].data() as ApiKey;
  return { organizationId: apiKey.organizationId };
}

// Every request from an installed agent carries X-Agent-Token.
export async function requireAgentToken(req: NextRequest): Promise<{ agentId: string; organizationId: string }> {
  const token = req.headers.get("X-Agent-Token");
  if (!token) throw new AuthError("Missing X-Agent-Token header");

  const snapshot = await getDb().collection("agents").where("token", "==", token).limit(1).get();
  if (snapshot.empty) throw new AuthError("Invalid agent token");

  const doc = snapshot.docs[0];
  const agent = doc.data() as Agent;

  await doc.ref.update({ lastSeenAt: new Date() });

  return { agentId: doc.id, organizationId: agent.organizationId };
}
