import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Phones open the app through the ngrok tunnel (web phone mode).
  devIndicators: false,
  allowedDevOrigins: ["*.ngrok-free.dev", "*.ngrok-free.app"],
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
