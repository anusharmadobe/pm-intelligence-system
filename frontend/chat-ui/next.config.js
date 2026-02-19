/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000',
  },
  // Skip static generation for client-side app
  // This app uses localStorage and requires client-side rendering
  output: 'standalone',
  // Disable static optimization for error pages
  experimental: {
    optimizeCss: false,
  },
}

module.exports = nextConfig
