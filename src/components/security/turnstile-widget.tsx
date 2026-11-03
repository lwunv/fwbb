"use client";

import { useEffect, useRef } from "react";

// NOTE: next.config.ts has no Content-Security-Policy yet. Whoever adds one
// must allow https://challenges.cloudflare.com in both `script-src` and
// `frame-src`, otherwise the widget silently stops loading.

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      theme: "auto";
      size: "flexible";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
      "timeout-callback": () => void;
    },
  ) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

/** Load Cloudflare's script once per page; a failed load can be retried. */
function loadTurnstile(): Promise<TurnstileApi> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("turnstile needs a browser"));
  }
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error("turnstile global missing after load"));
    };
    script.onerror = () => reject(new Error("turnstile script failed to load"));
    document.head.appendChild(script);
  }).catch((err: unknown) => {
    scriptPromise = null;
    throw err;
  });
  return scriptPromise;
}

type TurnstileWidgetProps = {
  /** Server checks the same `action` in `verifyTurnstile`. */
  action: string;
  /** Token when solved; null when it expires, errors or is reset. */
  onToken: (token: string | null) => void;
  /** Bump after a submit: tokens are single-use, so the widget must re-run. */
  resetKey: number;
};

/**
 * Cloudflare Turnstile challenge. `size: "flexible"` lets it shrink to the
 * container width, so it never causes horizontal scroll on small phones.
 */
export function TurnstileWidget({
  action,
  onToken,
  resetKey,
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  // Keep the latest callback without re-creating the widget on every render.
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    if (!siteKey) {
      console.error("[Turnstile] missing NEXT_PUBLIC_TURNSTILE_SITE_KEY");
      onTokenRef.current(null);
      return;
    }

    let cancelled = false;
    let api: TurnstileApi | undefined;
    loadTurnstile()
      .then((t) => {
        const el = containerRef.current;
        if (cancelled || !el) return;
        api = t;
        widgetIdRef.current = t.render(el, {
          sitekey: siteKey,
          action,
          theme: "auto",
          size: "flexible",
          callback: (token) => onTokenRef.current(token),
          "expired-callback": () => onTokenRef.current(null),
          "error-callback": () => onTokenRef.current(null),
          "timeout-callback": () => onTokenRef.current(null),
        });
      })
      .catch(() => {
        console.error("[Turnstile] script failed to load");
        onTokenRef.current(null);
      });

    return () => {
      cancelled = true;
      const id = widgetIdRef.current;
      widgetIdRef.current = null;
      if (api && id !== null) api.remove(id);
    };
  }, [action]);

  const lastResetKey = useRef(resetKey);
  useEffect(() => {
    if (lastResetKey.current === resetKey) return;
    lastResetKey.current = resetKey;
    const id = widgetIdRef.current;
    if (id !== null) window.turnstile?.reset(id);
    onTokenRef.current(null);
  }, [resetKey]);

  // min-h matches the 65px flexible widget so the form below does not jump.
  return (
    <div
      ref={containerRef}
      className="min-h-[65px] w-full max-w-full overflow-hidden"
    />
  );
}
