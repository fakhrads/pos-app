import withSerwistInit from "@serwist/next";

import type { NextConfig } from "next";

const withSerwist = withSerwistInit({
  // Wajib isi: path ke file worker & output sw.js
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  // SW hanya aktif di production (dev server tidak pakai SW)
  disable: process.env.NODE_ENV === "development",
  reloadOnOnline: true,
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
};

export default withSerwist(nextConfig);
