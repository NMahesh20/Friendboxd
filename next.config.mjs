/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep native/heavy server-side packages out of the bundler.
  serverExternalPackages: ['playwright', 'playwright-core', '@sparticuz/chromium', 'cheerio'],
  // Vercel's file tracer drops playwright-core's browsers.json (loaded via
  // require at module init) and @sparticuz/chromium's binary — force-include
  // them so the stealth browser can launch on serverless.
  outputFileTracingIncludes: {
    '/api/analyze': [
      './node_modules/playwright-core/browsers.json',
      './node_modules/@sparticuz/chromium/bin/**',
    ],
    '/api/recommend': [
      './node_modules/playwright-core/browsers.json',
      './node_modules/@sparticuz/chromium/bin/**',
    ],
    '/api/friends': [
      './node_modules/playwright-core/browsers.json',
      './node_modules/@sparticuz/chromium/bin/**',
    ],
  },
  // Emit a minimal self-contained server (.next/standalone) so the Docker
  // image only ships the traced runtime — no dev deps, no source.
  output: 'standalone',
};

export default nextConfig;