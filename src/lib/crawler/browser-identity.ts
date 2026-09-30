// ─── Playwright browser identity (native Chromium) ────────────────────────
// A coherent signal set for the BROWSER strategy, as opposed to
// fingerprint.ts, which describes the curl-impersonate HTTP strategy.
//
// The distinction matters. fingerprint.ts describes a Chrome 131 Windows
// client and is correct there: curl-impersonate reproduces Chrome 131's TLS
// and JA3, so a Chrome 131 header set is the honest description of that
// handshake. Playwright, by contrast, launches a real Chromium binary — so
// overriding its UA to claim "Chrome 131 on Windows" makes the browser
// contradict ITSELF, and reCAPTCHA scores the contradictions:
//
//   wire user-agent  : Chrome/131.0.0.0 ... Windows NT 10.0
//   navigator.platform              : Linux x86_64     ← contradiction
//   navigator.userAgentData.brands  : Chromium v153     ← contradiction
//   WebGL renderer                  : SwiftShader      ← software GPU
//
// Playwright's `userAgent` context option rewrites only the header string; it
// does not touch the values Chromium derives from the binary, and no UA string
// can fix the software renderer. So this module does the opposite of
// fingerprint.ts: it keeps the binary's own native identity and only removes
// the tokens that scream "automation" — the literal "HeadlessChrome" token and
// the webdriver flag — plus the one signal a headless container genuinely
// cannot produce natively (a hardware GPU).
//
// Do NOT add the `x-browser-*`, `x-client-data`, or `available-dictionary`
// headers from a captured Google request. Those are emitted by Google's own
// first-party JS (gstatic/recaptcha bundles), never by Chrome's network stack,
// so a request to a non-Google origin carrying them is a visible forgery.

/** Chromium build shipped by Playwright. Matches the running binary, by design. */
export const CHROMIUM_MAJOR = 153;

/**
 * The binary's own UA with the "Headless" token removed. Everything else
 * (platform, brands, WebGL, hardware) is left native so the whole set stays
 * internally consistent — a real Chromium 153 on Linux.
 */
export const NATIVE_UA =
  `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ` +
  `Chrome/${CHROMIUM_MAJOR}.0.0.0 Safari/537.36`;

/**
 * Accept-Language copied from a real desktop Chrome session. Only browser-
 * emitted headers belong here; see the note above on `x-browser-*`.
 */
export const ACCEPT_LANGUAGE = 'en-IN,en-GB;q=0.9,en-US;q=0.8,en;q=0.7';

/**
 * Client Hints for the Chromium 153 build. These are what the binary emits
 * natively anyway, so they are listed only to document the expected values —
 * don't override them, or the wire stops matching the JS-visible brand list.
 */
export const NATIVE_SEC_CH_UA =
  `"Google Chrome";v="${CHROMIUM_MAJOR}", "Chromium";v="${CHROMIUM_MAJOR}", "Not_A Brand";v="8"`;

/**
 * Headers to ADD to the context on top of Chromium's native set. Kept minimal
 * and honest — the native sec-ch-ua* family is deliberately absent, because
 * supplying it by hand is what created the version mismatch in the first
 * place.
 */
export function extraHeaders(): Record<string, string> {
  return { 'Accept-Language': ACCEPT_LANGUAGE };
}

/**
 * Init script that closes the gaps a headless container can't cover natively.
 * Applied to every document in the context.
 *
 * Deliberately NOT masked, unlike the old stealth init script:
 *   - `navigator.plugins` — headless Chromium already reports the correct set
 *     of 5 PDF viewers. Overriding it with a plain `[1,2,3,4,5]` array made the
 *     value LESS realistic than leaving it alone.
 *   - `navigator.userAgentData` — matches the native Chromium 153 brands
 *     exactly; overriding it is what produced the 131-vs-153 contradiction.
 *   - `navigator.platform` — already "Linux x86_64", consistent with the UA.
 */
export function stealthInitScript(): void {
  // webdriver: the launch flag handles the blink runtime, this covers the
  // remaining timing where it can still be observed as true.
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

  // Keep navigator.languages in step with the Accept-Language we send, so the
  // wire and the JS agree.
  Object.defineProperty(navigator, 'languages', {
    get: () => ['en-IN', 'en-GB', 'en-US', 'en'],
  });

  // The one signal no amount of configuration can fix honestly: there is no
  // GPU in the container, so ANGLE falls back to SwiftShader. reCAPTCHA treats
  // a software renderer as a strong bot signal, so report a real GPU instead.
  // Kept Linux/Vulkan-shaped to match the X11 UA and the "Linux" client hint —
  // a Direct3D renderer string under a Linux UA would be its own contradiction.
  const RENDERER = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060/PCIe/SSE2, Vulkan 1.3.280)';
  const VENDOR = 'Google Inc. (NVIDIA)';

  // Patch the context PROTOTYPE rather than a throwaway context's own prototype
  // lookup — every later canvas in the page has to report the same string, and
  // the instance-scoped version of this patch silently had no effect.
  const patch = (Ctor: { prototype?: object } | undefined) => {
    const proto = Ctor?.prototype as
      | { getParameter?: (id: number) => unknown; __patched?: boolean }
      | undefined;
    if (!proto?.getParameter || proto.__patched) return;
    const original = proto.getParameter;
    proto.getParameter = function (id: number) {
      // UNMASKED_VENDOR_WEBGL / UNMASKED_RENDERER_WEBGL
      if (id === 0x9245) return VENDOR;
      if (id === 0x9246) return RENDERER;
      return original.call(this, id);
    };
    proto.__patched = true;
  };

  const w = window as unknown as {
    WebGLRenderingContext?: { prototype?: object };
    WebGL2RenderingContext?: { prototype?: object };
  };
  patch(w.WebGLRenderingContext);
  patch(w.WebGL2RenderingContext);
}
