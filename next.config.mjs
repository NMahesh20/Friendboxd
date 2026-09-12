/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep native/heavy server-side packages out of the bundler.
  serverExternalPackages: ['playwright', 'playwright-core', 'cheerio'],
};

export default nextConfig;