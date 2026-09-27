/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep native/heavy server-side packages out of the bundler.
  serverExternalPackages: ['playwright', 'playwright-core', 'cheerio'],
  // Emit a minimal self-contained server (.next/standalone) so the Docker
  // image only ships the traced runtime — no dev deps, no source.
  output: 'standalone',
  // The whole app lives at `/`, so bounce every other path back to it (307).
  // Redirects run before the filesystem, so the app's own routes have to be
  // excluded explicitly: `api/*` (route handlers), `_next/*` (build output)
  // and the metadata icon. `+` (rather than `*`) keeps `/` from matching
  // itself, which would be a redirect loop.
  async redirects() {
    return [
      {
        source: '/:path((?!(?:api|_next|icon\\.png)(?:/|$)).+)',
        destination: '/',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;