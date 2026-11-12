"use client";

import { useApiKey } from "./ApiKeyProvider";

// Dev convenience: the dashboard isn't behind its own auth system (per plan
// decision, the existing X-Api-Key model is kept as-is). The operator pastes
// the key from `npm run seed` or `POST /agents` here; it's stored in
// localStorage and attached to every dashboard fetch.
export function ApiKeyInput() {
  const { apiKey, setApiKey } = useApiKey();

  return (
    <input
      type="text"
      placeholder="X-Api-Key"
      value={apiKey}
      onChange={(e) => setApiKey(e.target.value)}
      style={{ width: 320, padding: 4 }}
    />
  );
}
