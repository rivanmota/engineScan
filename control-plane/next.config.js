const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin the workspace root to this project; avoids Next.js mistakenly
  // picking up an unrelated lockfile from a parent directory.
  outputFileTracingRoot: path.join(__dirname),
};

module.exports = nextConfig;
