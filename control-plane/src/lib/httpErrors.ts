import { NextResponse } from "next/server";
import { AuthError } from "./auth";
import { ScopeViolation } from "./scanScope";

// Shared mapping from thrown errors to JSON responses, used by every route
// handler so AuthError/ScopeViolation behave the same way the old Express
// middlewares did.
export function errorResponse(e: unknown): NextResponse {
  if (e instanceof AuthError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  if (e instanceof ScopeViolation) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
  console.error(e);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
