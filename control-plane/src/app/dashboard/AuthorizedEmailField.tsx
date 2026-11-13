"use client";

import { useState } from "react";
import { authorizerDomainError, targetRegistrableDomain } from "@/lib/authorizedDomain";

// The "Authorized by (email)" input used by every form that records an
// authorization attestation (new scan, new schedule, renewal). It enforces
// the same rule as the API (src/lib/authorizedDomain.ts): the email must be
// at the target URL's domain. The hint says which domain is expected; the
// error appears once the field has been left, or when the form is submitted.
export function AuthorizedEmailField({
  id,
  value,
  onChange,
  targetUrl,
  forceShowError = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  targetUrl: string;
  // Set after a submit attempt, so the error shows even if the field was never left.
  forceShowError?: boolean;
}) {
  const [touched, setTouched] = useState(false);
  const error = authorizerDomainError(targetUrl, value);
  const showError = !!error && (touched || forceShowError);
  const expectedDomain = targetRegistrableDomain(targetUrl);
  const messageId = `${id}-message`;

  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        Authorized by (email)
      </label>
      <input
        id={id}
        type="email"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setTouched(true)}
        required
        className={`input${showError ? " input-invalid" : ""}`}
        aria-invalid={showError}
        aria-describedby={messageId}
      />
      {showError ? (
        <span id={messageId} className="field-error" role="alert">
          {error}
        </span>
      ) : (
        <span id={messageId} className="field-hint">
          {expectedDomain
            ? `Must be an email address at ${expectedDomain} (the target's domain).`
            : "Must be an email address at the target URL's domain."}
        </span>
      )}
    </div>
  );
}
