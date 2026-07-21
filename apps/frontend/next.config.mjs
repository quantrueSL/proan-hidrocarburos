/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output: production Dockerfile copies .next/standalone
  // (self-contained server + traced node_modules) instead of full node_modules.
  // Does not affect `next dev` in the dev container.
  output: "standalone"
};

export default nextConfig;

