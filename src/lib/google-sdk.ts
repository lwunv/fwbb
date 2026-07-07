/**
 * Google Identity Services (GIS) client wrapper.
 *
 * Dùng GIS thay vì legacy gapi để có ID token JWT trực tiếp, server verify
 * qua Google's tokeninfo endpoint hoặc jwks. Flow:
 *   1. initGoogleSDK() — inject GSI script + initialize với client id
 *   2. signInWithGoogle() — popup OAuth, resolve với ID token (JWT)
 *   3. Server: googleLogin(idToken) — verify với Google tokeninfo
 */

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (options: {
            client_id: string;
            callback: (response: { credential: string }) => void;
            ux_mode?: "popup" | "redirect";
            auto_select?: boolean;
            use_fedcm_for_prompt?: boolean;
            use_fedcm_for_button?: boolean;
            itp_support?: boolean;
          }) => void;
          prompt: (
            momentListener?: (notification: {
              isNotDisplayed: () => boolean;
              isSkippedMoment: () => boolean;
            }) => void,
          ) => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              type?: "standard" | "icon";
              theme?: "outline" | "filled_blue" | "filled_black";
              size?: "large" | "medium" | "small";
              text?: "signin_with" | "signup_with" | "continue_with" | "signin";
              shape?: "rectangular" | "pill" | "circle" | "square";
              width?: number | string;
              logo_alignment?: "left" | "center";
              locale?: string;
            },
          ) => void;
          disableAutoSelect: () => void;
        };
        oauth2?: {
          initTokenClient: (options: {
            client_id: string;
            scope: string;
            callback: (response: { access_token?: string }) => void;
          }) => { requestAccessToken: () => void };
        };
      };
    };
  }
}

const SDK_TIMEOUT_MS = 10_000;
const GIS_SCRIPT_ID = "google-identity-services";
const GIS_SRC = "https://accounts.google.com/gsi/client";

let scriptLoaded = false;

/**
 * Each `signInWithGoogle()` / `renderGoogleButton()` call re-runs
 * `accounts.id.initialize()` with its OWN callback closure, replacing the
 * previous global handler. This sidesteps the shared-state bug where a
 * module-level `pendingCredential` was overwritten by re-renders (e.g.
 * locale change re-running renderGoogleButton mid-flow): if the previous
 * caller had an in-flight handler, the late-arriving token used to go to
 * the wrong callback. With per-call init, the most recently registered
 * caller is canonical — older callers' buttons are already unmounted so
 * they can't fire anyway.
 */
function reInitializeWithCallback(
  clientId: string,
  callback: (idToken: string) => void,
) {
  window.google!.accounts!.id!.initialize({
    client_id: clientId,
    callback: (response) => callback(response.credential),
    ux_mode: "popup",
    auto_select: false,
  });
}

function loadScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (scriptLoaded && window.google?.accounts?.id) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      reject(new Error("Google Identity Services load timeout"));
    }, SDK_TIMEOUT_MS);

    const onReady = () => {
      clearTimeout(timer);
      scriptLoaded = true;
      resolve();
    };

    if (window.google?.accounts?.id) {
      onReady();
      return;
    }

    if (!document.getElementById(GIS_SCRIPT_ID)) {
      const script = document.createElement("script");
      script.id = GIS_SCRIPT_ID;
      script.src = GIS_SRC;
      script.async = true;
      script.defer = true;
      script.onload = onReady;
      script.onerror = () => {
        clearTimeout(timer);
        reject(new Error("Failed to load Google Identity Services"));
      };
      document.head.appendChild(script);
    } else {
      const existing = document.getElementById(GIS_SCRIPT_ID);
      existing?.addEventListener("load", onReady, { once: true });
    }
  });
}

export async function initGoogleSDK(): Promise<void> {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error("NEXT_PUBLIC_GOOGLE_CLIENT_ID not configured");
  }
  await loadScript();
}

/**
 * Mở Google One-Tap / popup. Resolve khi user pick account, reject nếu
 * user dismiss hoặc skip. ID token là JWT có chứa `sub` (Google user id),
 * `email`, `name`, `picture`.
 */
export function signInWithGoogle(): Promise<string> {
  return new Promise((resolve, reject) => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) {
      reject(new Error("NEXT_PUBLIC_GOOGLE_CLIENT_ID not configured"));
      return;
    }
    if (!scriptLoaded || !window.google?.accounts?.id) {
      reject(new Error("Google SDK not initialized"));
      return;
    }
    // Per-call init: the closure captures THIS Promise's resolve, so even if
    // another caller re-initializes mid-flow, our resolve is dead and
    // can't be invoked by accident with the other caller's token.
    reInitializeWithCallback(clientId, resolve);
    window.google.accounts.id.prompt((notification) => {
      if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
        reject(new Error("User dismissed Google sign-in"));
      }
    });
  });
}

/**
 * Render official Google button vào parent element. Click → trigger flow,
 * ID token sẽ về callback init ở `initGoogleSDK`.
 *
 * Note: button-rendered flow KHÔNG cần signInWithGoogle. Caller chỉ cần
 * gọi initGoogleSDK + renderGoogleButton, callback của initialize sẽ fire.
 */
export function renderGoogleButton(
  parent: HTMLElement,
  onCredential: (idToken: string) => void,
  options?: { width?: number; locale?: string },
) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error("NEXT_PUBLIC_GOOGLE_CLIENT_ID not configured");
  }
  if (!scriptLoaded || !window.google?.accounts?.id) {
    throw new Error("Google SDK not initialized");
  }
  // Per-render init: this button's clicks fire onCredential via a closure.
  // A subsequent renderGoogleButton call re-initializes with the new
  // callback; this button — being unmounted by React before that point —
  // can't fire anymore so the stale callback isn't reachable.
  reInitializeWithCallback(clientId, onCredential);
  window.google.accounts.id.renderButton(parent, {
    type: "standard",
    theme: "outline",
    size: "large",
    text: "continue_with",
    // Pill + full-width (caller passes container width) để khớp nút bấm bo
    // tròn của app, thay vì nút hẹp lệch giữa trông rời rạc.
    shape: "pill",
    width: options?.width ?? 300,
    logo_alignment: "center",
    locale: options?.locale,
  });
}
