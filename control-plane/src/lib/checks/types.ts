import { Finding } from "@/types/firestore";

// Shared contract for every check module (src/lib/checks/*.ts).

export interface CheckContext {
  targetUrl: string;
}

export type FindingInput = Omit<Finding, "id" | "scanId" | "createdAt">;

export type Check = (ctx: CheckContext) => Promise<FindingInput[]>;
