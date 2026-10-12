import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@moneymart/tokens', '@moneymart/types'],
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  // Data-URI SVG artwork is generated server-side, so keep images unoptimised.
  images: { unoptimized: true },
};

export default nextConfig;
