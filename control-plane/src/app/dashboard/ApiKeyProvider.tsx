"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

const STORAGE_KEY = "enginescan.apiKey";

interface ApiKeyContextValue {
  apiKey: string;
  setApiKey: (key: string) => void;
}

const ApiKeyContext = createContext<ApiKeyContextValue>({ apiKey: "", setApiKey: () => {} });

export function ApiKeyProvider({ children }: { children: ReactNode }) {
  const [apiKey, setApiKeyState] = useState("");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) setApiKeyState(stored);
  }, []);

  function setApiKey(key: string) {
    setApiKeyState(key);
    window.localStorage.setItem(STORAGE_KEY, key);
  }

  return <ApiKeyContext.Provider value={{ apiKey, setApiKey }}>{children}</ApiKeyContext.Provider>;
}

export function useApiKey() {
  return useContext(ApiKeyContext);
}
