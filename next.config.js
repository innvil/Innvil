/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: [],
  },
  env: {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  },
  // ffmpeg-static's downloaded binary isn't detected by Next's default
  // require()-based file tracing, so it gets silently excluded from the
  // serverless function bundle (confirmed live: ENOENT on Vercel) unless
  // force-included here for every route that can reach media-frame-
  // extractor.ts (video moderation + its diagnostic check).
  outputFileTracingIncludes: {
    '/api/webhooks/telegram/bots/[integrationId]': ['./node_modules/ffmpeg-static/**'],
    '/api/debug/ffmpeg-check': ['./node_modules/ffmpeg-static/**'],
  },
};

module.exports = nextConfig;
