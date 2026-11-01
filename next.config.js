/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: [],
  },
  env: {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  },
  // ffmpeg-static resolves its binary PATH dynamically at runtime (based on
  // process.platform/arch), so static require()/import analysis can never
  // determine which actual file is needed at build time -- Turbopack's own
  // bundling/tracing was silently excluding it (confirmed live: the binary
  // existed on disk at build time but not in the deployed function). Marking
  // it external keeps it as a genuine node_modules require at runtime
  // instead of routing it through the bundler at all -- the officially
  // documented fix for exactly this class of native-binary package, and the
  // one that actually resolved it live (verified: real `ffmpeg -version`
  // output on Vercel's Linux runtime).
  serverExternalPackages: ['ffmpeg-static'],
};

module.exports = nextConfig;
