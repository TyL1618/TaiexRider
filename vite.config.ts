import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // prompt：偵測到新版時呼叫 onNeedRefresh，由 src/pwa.ts 決定何時 reload
      // （遊玩中先 defer，回首頁再套用）。injectRegister:null → 不自動注入註冊腳本，
      // 改由 src/pwa.ts 透過 virtual:pwa-register 手動註冊。
      registerType: "prompt",
      injectRegister: null,
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
        // 安裝版 PWA 長按圖示捷徑（TWA 走原生 android/res/xml/shortcuts.xml，
        // 兩者都用 ?goto= 深連結，由 App.tsx 接應導頁）
        shortcuts: [
          {
            name: "每日排名賽",
            short_name: "排名賽",
            url: "/?goto=daily",
            icons: [{ src: "icon-192.png", sizes: "192x192", type: "image/png" }],
          },
          {
            name: "隨機拉霸",
            short_name: "拉霸",
            url: "/?goto=random",
            icons: [{ src: "icon-192.png", sizes: "192x192", type: "image/png" }],
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // 不設 skipWaiting：prompt 模式需要等待中的新 SW 才能觸發 onNeedRefresh，
        // 由 updateSW(true) 在適當時機（非遊玩中）主動 skipWaiting + reload。
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
