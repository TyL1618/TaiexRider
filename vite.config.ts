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
        ],
      },
      workbox: {
        // 靜態資源 cache-first；每日賽道 API 之後在 Phase 5 再加 runtimeCaching
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
});
