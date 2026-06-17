import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "TaiexRider",
        short_name: "TaiexRider",
        description: "把台股走勢變成霓虹機車賽道的單指小遊戲",
        theme_color: "#05080f",
        background_color: "#05080f",
        display: "fullscreen",
        orientation: "portrait",
        icons: [
          {
            src: "favicon.svg",
            sizes: "any",
            type: "image/svg+xml",
          },
          {
            src: "icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            // 每日地圖：StaleWhileRevalidate，快取 24 小時
            urlPattern: /\/rest\/v1\/daily_map/,
            handler: "StaleWhileRevalidate" as const,
            options: {
              cacheName: "daily-map-v1",
              expiration: { maxAgeSeconds: 60 * 60 * 24, maxEntries: 5 },
            },
          },
          {
            // 排行榜：NetworkFirst，失敗 fallback 到快取（5 分鐘有效）
            urlPattern: /\/rest\/v1\/daily_scores/,
            handler: "NetworkFirst" as const,
            options: {
              cacheName: "leaderboard-v1",
              networkTimeoutSeconds: 5,
              expiration: { maxAgeSeconds: 60 * 5, maxEntries: 5 },
            },
          },
          {
            // Supabase RPC（submit 等寫入）：NetworkOnly，不快取
            urlPattern: /\/rest\/v1\/rpc\//,
            handler: "NetworkOnly" as const,
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
});
