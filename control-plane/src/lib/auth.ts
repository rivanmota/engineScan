import { NextRequest } from "next/server";
import { getDb } from "./firestore";
import { ApiKey } from "@/types/firestore";

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
