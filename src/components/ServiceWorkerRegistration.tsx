"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/service-worker.js").catch((error: unknown) => {
        console.warn("GameNight offline support could not be registered.", error);
      });
    }
  }, []);

  return null;
}
