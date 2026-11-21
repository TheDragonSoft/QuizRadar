import { describe, expect, it } from "vitest";
import {
  DEFAULT_BROWSER_GOOGLE_CLIENT_ID,
  explainOAuthError,
  isValidMicrosoftClientId,
  resolveBrowserGoogleClientId,
  resolveBrowserMicrosoftClientId,
  resolveBrowserMicrosoftRedirectUri,
} from "./browserSources";

describe("browserSources OAuth client ID & redirect URI helpers", () => {
  const validGuid = "14d82eec-204b-4c2f-b7e8-296a70dab67e";
  const customGuid = "a1b2c3d4-e5f6-4789-abcd-0123456789ef";

  it("validates Microsoft Entra GUIDs and rejects placeholders", () => {
    expect(isValidMicrosoftClientId(validGuid)).toBe(true);
    expect(isValidMicrosoftClientId(`  ${customGuid}  `)).toBe(true);
    expect(isValidMicrosoftClientId(null)).toBe(false);
    expect(isValidMicrosoftClientId("")).toBe(false);
    expect(isValidMicrosoftClientId("00000000-0000-0000-0000-000000000000")).toBe(false);
    expect(isValidMicrosoftClientId("quizradar-android-public-ms")).toBe(false);
  });

  it("resolves Microsoft client ID preferring user override then bundled Entra GUID", () => {
    expect(resolveBrowserMicrosoftClientId(customGuid, validGuid)).toBe(customGuid);
    expect(resolveBrowserMicrosoftClientId("   ", validGuid)).toBe(validGuid);
    expect(resolveBrowserMicrosoftClientId("quizradar-android-public-ms", validGuid)).toBe(
      validGuid,
    );
    expect(resolveBrowserMicrosoftClientId(null, null)).toBeNull();
  });

  it("resolves Google client ID with bundled public fallback", () => {
    expect(resolveBrowserGoogleClientId("custom-google.apps.googleusercontent.com")).toBe(
      "custom-google.apps.googleusercontent.com",
    );
    expect(resolveBrowserGoogleClientId("")).toBe(DEFAULT_BROWSER_GOOGLE_CLIENT_ID);
  });

  it("computes SPA redirect URIs cleanly for localhost and GitHub Pages subpaths", () => {
    expect(resolveBrowserMicrosoftRedirectUri("http://localhost:5173/")).toBe(
      "http://localhost:5173/",
    );
    expect(
      resolveBrowserMicrosoftRedirectUri(
        "https://thedragonsoft.github.io/QuizRadar/app/#course=qrpack1_abc",
      ),
    ).toBe("https://thedragonsoft.github.io/QuizRadar/app/");
    expect(
      resolveBrowserMicrosoftRedirectUri("https://thedragonsoft.github.io/QuizRadar/app/?tab=week"),
    ).toBe("https://thedragonsoft.github.io/QuizRadar/app/");
  });

  it("explains Google org_internal and access_denied errors with honest offline fallbacks", () => {
    const org = explainOAuthError("google", "Error 400: admin_policy_enforced");
    expect(org).toContain("administrator");
    expect(org).toContain(".ics");

    const denied = explainOAuthError("google", "access_denied");
    expect(denied).toContain("Syllabus Import");
  });
});
