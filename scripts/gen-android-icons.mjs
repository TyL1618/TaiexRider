// 從 public/favicon.svg 產生 Android launcher icon（Capacitor 實驗專案專用）。
//
// 為什麼要自己產：TWA 專案 android/ 底下的 drawable/ic_launcher_{background,foreground}.xml
// 其實是 Android Studio 的「預設機器人樣板」，從來沒被改過（背景 #3DDC84 就是 Android 綠），
// 真正的 TaiexRider 圖只存在 mipmap-*/ic_launcher.webp 點陣圖裡。直接把 TWA 的 drawable
// + mipmap-anydpi-v26 搬過來，會因為 anydpi-v26 在 Android 8+ 優先於 webp，反而顯示成
// 安卓預設機器人（2026-07-10 真機踩過）。所以這裡直接用向量原稿重新產一套。
//
// Adaptive icon 規格：畫布 108dp，中央 72dp 是「安全區」（launcher 遮罩後大致可見的範圍）。
// 前景層＝只有線圖+輪子的美術（去掉圓角深色底），置中縮到 72dp；背景層＝品牌底色 #05080f。
// 兩層底色一致，所以視覺上就跟原本那顆圓角深色方形 icon 一樣，但能吃 launcher 的遮罩形狀。
//
// 用法：node scripts/gen-android-icons.mjs

import sharp from "sharp";
import { writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const RES = join(__dir, "../android/app/src/main/res");

const BG = "#05080f"; // favicon.svg 的底色，實測 icon-512.png 每個非透明像素都是 rgb(5,8,15)

// 只有美術、沒有圓角底的前景（拿掉 favicon.svg 裡的 <rect>）
const FOREGROUND_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <polyline points="6,44 18,40 26,46 34,20 44,34 58,14" fill="none"
    stroke="#2de2e6" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
  <circle cx="22" cy="50" r="6" fill="none" stroke="#ffb300" stroke-width="2.5" />
  <circle cx="44" cy="50" r="6" fill="none" stroke="#ffb300" stroke-width="2.5" />
</svg>`;

// 完整 icon（含圓角底），給 API 25 以下的 launcher 當點陣後備圖
const LEGACY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="${BG}" />
  <polyline points="6,44 18,40 26,46 34,20 44,34 58,14" fill="none"
    stroke="#2de2e6" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
  <circle cx="22" cy="50" r="6" fill="none" stroke="#ffb300" stroke-width="2.5" />
  <circle cx="44" cy="50" r="6" fill="none" stroke="#ffb300" stroke-width="2.5" />
</svg>`;

// density → [adaptive 前景畫布 108dp, legacy 圖示 48dp]
const DENSITIES = {
  mdpi: [108, 48],
  hdpi: [162, 72],
  xhdpi: [216, 96],
  xxhdpi: [324, 144],
  xxxhdpi: [432, 192],
};

const circleMask = (size) =>
  Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`,
  );

for (const [density, [canvas, legacy]] of Object.entries(DENSITIES)) {
  const dir = join(RES, `mipmap-${density}`);
  mkdirSync(dir, { recursive: true });

  // --- adaptive 前景：美術縮到安全區(canvas * 72/108)，四周透明留白置中 ---
  const art = Math.round((canvas * 2) / 3);
  const pad = (canvas - art) / 2;
  await sharp(Buffer.from(FOREGROUND_SVG))
    .resize(art, art)
    .extend({
      top: pad, bottom: pad, left: pad, right: pad,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(join(dir, "ic_launcher_foreground.png"));

  // --- legacy 方形圖示 ---
  const square = await sharp(Buffer.from(LEGACY_SVG)).resize(legacy, legacy).png().toBuffer();
  writeFileSync(join(dir, "ic_launcher.png"), square);

  // --- legacy 圓形圖示：同一張圖套圓形遮罩 ---
  await sharp(square)
    .composite([{ input: circleMask(legacy), blend: "dest-in" }])
    .png()
    .toFile(join(dir, "ic_launcher_round.png"));

  console.log(`✓ mipmap-${density}  前景 ${art}/${canvas}px・legacy ${legacy}px`);
}

// 背景層顏色（mipmap-anydpi-v26/ic_launcher.xml 以 @color/ic_launcher_background 引用）
writeFileSync(
  join(RES, "values/ic_launcher_background.xml"),
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${BG}</color>
</resources>
`,
);
console.log(`✓ values/ic_launcher_background.xml → ${BG}`);

// adaptive-icon 定義（API 26+）。monochrome 讓 Android 13+ 的「主題化圖示」也有正確剪影。
const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`;
for (const name of ["ic_launcher.xml", "ic_launcher_round.xml"]) {
  writeFileSync(join(RES, "mipmap-anydpi-v26", name), adaptive);
  console.log(`✓ mipmap-anydpi-v26/${name}`);
}
