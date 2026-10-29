import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAppStore, initialFullState } from "../state/store";
import { setRpcMockHandler } from "../state/rpc";
import {
  base64UrlEncode,
  explainOAuthError,
  pkceChallenge,
  randomB64Url,
} from "../pwadapters/browserSources";

/**
 * Regression coverage for the "Google / Teams sign-in button does nothing"
 * report (issue: the auth buttons were wired to an RPC whose result was
 * discarded, so no browser was ever opened and no error was ever shown).
 */
describe("Sign-in actions actually do something", () => {
  beforeEach(() => {
    setRpcMockHandler(null);
    useAppStore.setState({
      data: {
        ...initialFullState,
        auth: { ...initialFullState.auth },
        config: { ...initialFullState.config },
      },
      toasts: [],
    });
  });

  it("opens the desktop Google authorize URL instead of discarding it", async () => {
    const authorizeUrl = "https://accounts.google.com/o/oauth2/v2/auth?client_id=abc";
    setRpcMockHandler(((fn: string) => {
      if (fn === "google_login_start") return Promise.resolve(authorizeUrl);
      return null;
    }) as never);

    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    const result = await useAppStore.getState().googleLogin();

    expect(result).toBe(authorizeUrl);
    // The URL must reach the browser — this is what the broken build dropped.
    expect(openSpy).toHaveBeenCalledWith(authorizeUrl, "_blank", "noopener");
    openSpy.mockRestore();
  });

  it("opens the desktop Microsoft authorize URL instead of discarding it", async () => {
    const authorizeUrl = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?x=1";
    setRpcMockHandler(((fn: string) => {
      if (fn === "microsoft_login_start") return Promise.resolve(authorizeUrl);
      return null;
    }) as never);

    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    const result = await useAppStore.getState().microsoftLogin();

    expect(result).toBe(authorizeUrl);
    expect(openSpy).toHaveBeenCalledWith(authorizeUrl, "_blank", "noopener");
    openSpy.mockRestore();
  });

  it("reports an honest error in the browser tier when no Google client ID is configured", async () => {
    setRpcMockHandler(((fn: string) => {
      if (fn === "google_login_start") {
        return Promise.resolve({ url: null, port: null, mode: "gis" });
      }
      return null;
    }) as never);

    const result = await useAppStore.getState().googleLogin();

    expect(result).toBe("error");
    const toast = useAppStore.getState().toasts.at(-1);
    expect(toast?.type).toBe("error");
    expect(toast?.message).toMatch(/client ID/i);
  });

  it("reports an honest error in the browser tier when no Teams client ID is configured", async () => {
    setRpcMockHandler(((fn: string) => {
      if (fn === "microsoft_login_start") {
        return Promise.resolve({ url: null, port: null, mode: "pkce-popup" });
      }
      return null;
    }) as never);

    const result = await useAppStore.getState().microsoftLogin();

    expect(result).toBe("error");
    const toast = useAppStore.getState().toasts.at(-1);
    expect(toast?.type).toBe("error");
    expect(toast?.message).toMatch(/Azure app client ID/i);
  });

  it("never throws unhandled rejections out of the sign-in buttons", async () => {
    setRpcMockHandler((() => Promise.reject(new Error("IPC offline"))) as never);
    await expect(useAppStore.getState().googleLogin()).resolves.toBe("error");
    await expect(useAppStore.getState().microsoftLogin()).resolves.toBe("error");
  });

  it("surfaces a client-setup failure by opening Settings → Account instead of failing silently", async () => {
    const honestError =
      "The Google OAuth client ID in Settings is not usable. Copy it again from Google Cloud Console.";
    setRpcMockHandler((() => Promise.reject(new Error(honestError))) as never);

    const result = await useAppStore.getState().googleLogin();

    expect(result).toBe("error");
    const toast = useAppStore.getState().toasts.at(-1);
    expect(toast?.type).toBe("error");
    expect(toast?.message).toMatch(/usable client ID/i);
  });

  it("opens the incremental-consent URL for Microsoft scanning access", async () => {
    const consentUrl =
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?prompt=consent";
    setRpcMockHandler(((fn: string) => {
      if (fn === "microsoft_scanning_consent_start") return Promise.resolve(consentUrl);
      return null;
    }) as never);

    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    const result = await useAppStore.getState().microsoftGrantScanningAccess();

    expect(result).toBe(consentUrl);
    expect(openSpy).toHaveBeenCalledWith(consentUrl, "_blank", "noopener");
    openSpy.mockRestore();
  });
});

describe("Provider error explanations (browser tier)", () => {
  it("explains the Google web-client rejection with the actionable fix", () => {
    const explained = explainOAuthError(
      "google",
      '{"error":"invalid_request","error_description":"client_secret is missing."}',
    );
    expect(explained).toMatch(/client secret/i);
    expect(explained).toMatch(/Settings/);
  });

  it("explains the Microsoft administrator-approval case", () => {
    const explained = explainOAuthError(
      "microsoft",
      "AADSTS65001: The user or administrator has not consented to some permissions.",
    );
    expect(explained).toMatch(/administrator/i);
    expect(explained).toMatch(/personal Microsoft account/i);
  });

  it("passes unknown errors through verbatim", () => {
    const raw = '{"error":"temporarily_unavailable"}';
    expect(explainOAuthError("google", raw)).toBe(raw);
  });
});

describe("Browser PKCE helpers (RFC 7636)", () => {
  it("base64url-encodes without padding", () => {
    expect(base64UrlEncode(new Uint8Array([251, 255, 190]))).toBe("-_--");
    expect(base64UrlEncode(new Uint8Array([1]))).toBe("AQ");
  });

  it("derives the S256 challenge from the verifier", async () => {
    // RFC 7636 Appendix B vector
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = await pkceChallenge(verifier);
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("generates URL-safe random state/verifier material", () => {
    const value = randomB64Url(16);
    expect(value).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(value.length).toBeGreaterThan(10);
  });
});
