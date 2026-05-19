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
              width?: number;
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

let initialized = false;
let pendingCredential: ((idToken: string) => void) | null = null;

export function initGoogleSDK(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (initialized && window.google?.accounts?.id) {
      resolve();
      return;
    }

    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) {
      reject(new Error("NEXT_PUBLIC_GOOGLE_CLIENT_ID not configured"));
      return;
    }

    const timer = setTimeout(() => {
      reject(new Error("Google Identity Services load timeout"));
    }, SDK_TIMEOUT_MS);

    const onReady = () => {
      clearTimeout(timer);
      try {
        window.google!.accounts!.id!.initialize({
          client_id: clientId,
          callback: (response) => {
            if (pendingCredential) {
              const cb = pendingCredential;
              pendingCredential = null;
              cb(response.credential);
            }
          },
          ux_mode: "popup",
          auto_select: false,
        });
        initialized = true;
        resolve();
      } catch (err) {
        reject(err);
      }
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
      // Script already in DOM but not yet loaded — listen for it.
      const existing = document.getElementById(GIS_SCRIPT_ID);
      existing?.addEventListener("load", onReady, { once: true });
    }
  });
}

/**
 * Mở Google One-Tap / popup. Resolve khi user pick account, reject nếu
 * user dismiss hoặc skip. ID token là JWT có chứa `sub` (Google user id),
 * `email`, `name`, `picture`.
 */
export function signInWithGoogle(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!initialized || !window.google?.accounts?.id) {
      reject(new Error("Google SDK not initialized"));
      return;
    }
    pendingCredential = resolve;
    window.google.accounts.id.prompt((notification) => {
      if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
        pendingCredential = null;
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
  if (!initialized || !window.google?.accounts?.id) {
    throw new Error("Google SDK not initialized");
  }
  pendingCredential = onCredential;
  window.google.accounts.id.renderButton(parent, {
    type: "standard",
    theme: "outline",
    size: "large",
    text: "continue_with",
    shape: "rectangular",
    width: options?.width ?? 300,
    logo_alignment: "left",
    locale: options?.locale,
  });
}
