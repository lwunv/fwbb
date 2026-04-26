declare global {
  interface Window {
    FB: FacebookSDK;
    fbAsyncInit: () => void;
  }
}

interface FacebookAuthResponse {
  accessToken: string;
  userID: string;
}

interface FacebookLoginStatusResponse {
  status: string;
  authResponse?: FacebookAuthResponse;
}

interface FacebookSDK {
  init: (options: {
    appId: string | undefined;
    cookie: boolean;
    xfbml: boolean;
    version: string;
  }) => void;
  getLoginStatus: (
    callback: (response: FacebookLoginStatusResponse) => void,
  ) => void;
  login: (
    callback: (response: { authResponse?: FacebookAuthResponse }) => void,
    options: { scope: string },
  ) => void;
}

const SDK_TIMEOUT_MS = 10_000;

export function initFacebookSDK(): Promise<void> {
  return new Promise((resolve, reject) => {
    // If already initialized
    if (window.FB) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      reject(new Error("Facebook SDK load timeout"));
    }, SDK_TIMEOUT_MS);

    window.fbAsyncInit = function () {
      clearTimeout(timer);
      window.FB.init({
        appId: process.env.NEXT_PUBLIC_FB_APP_ID,
        cookie: true,
        xfbml: false,
        version: "v19.0",
      });
      resolve();
    };

    // Inject SDK script if not already in DOM
    if (!document.getElementById("facebook-jssdk")) {
      const script = document.createElement("script");
      script.id = "facebook-jssdk";
      script.src = "https://connect.facebook.net/en_US/sdk.js";
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  });
}

export function checkLoginStatus(): Promise<{
  status: string;
  authResponse?: { accessToken: string; userID: string };
}> {
  return new Promise((resolve) => {
    window.FB.getLoginStatus((response) => {
      resolve(response);
    });
  });
}

export function loginWithFacebook(): Promise<{
  accessToken: string;
  userID: string;
}> {
  return new Promise((resolve, reject) => {
    window.FB.login(
      (response) => {
        if (response.authResponse) {
          resolve(response.authResponse);
        } else {
          reject(new Error("User cancelled login"));
        }
      },
      { scope: "public_profile" },
    );
  });
}

export function isInFacebookBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return ua.includes("FBAN") || ua.includes("FBAV") || ua.includes("FB_IAB");
}
