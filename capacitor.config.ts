import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tylapp.taiexrider',
  appName: 'TaiexRider',
  webDir: 'dist',
  plugins: {
    SocialLogin: {
      providers: {
        google: true,
        facebook: false,
        apple: false,
        twitter: false,
      },
    },
    // 原生 SplashScreen 只負責蓋住冷啟動空窗（App 行程啟動 → WebView 首次 paint），
    // 底色跟 index.html 的品牌動畫 boot-splash 一致 #05080f 無縫接。launchAutoHide:false
    // → 不自動隱藏，改由 main.tsx 在 JS 一跑起來（boot-splash 已 paint）就手動 hide。
    SplashScreen: {
      backgroundColor: '#05080f',
      launchAutoHide: false,
      showSpinner: false,
      // 用純色 drawable，plugin 顯示時不放預設 splash.png 圖（品牌動畫交給 boot-splash）。
      androidSplashResourceName: 'splash_solid',
    },
  },
};

export default config;
