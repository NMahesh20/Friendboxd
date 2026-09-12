/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep native/heavy server-side packages out of the bundler.
  serverExternalPackages: ['playwright', 'playwright-core', 'cheerio'],
  // Emit a minimal self-contained server (.next/standalone) so the Docker
  // image only ships the traced runtime — no dev deps, no source.
  output: 'standalone',
};

export default nextConfig;