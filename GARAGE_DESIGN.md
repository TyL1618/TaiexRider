# TaiexRider 車庫系統設計（2026-07-03 定案方向，待實作）

> 目標：解決「目前只有一台車，玩家沒有長期收集/解鎖動力」的問題。
> 技術前提：物理體（圓形車身 r=10 + 兩個輪子 r=6）與貼圖完全分離——**換車皮只是換一張 PNG，不動物理/手感/難度/排行榜公平性**。
> 狀態：純設計 + AI 生圖 prompt 已備妥，尚未實作 code。

---

## 1. 技術規格（給 Grok 生圖用，也是未來實作對照表）

現有原圖：`public/bike.png`，**610×409 px**，側視朝右、無騎士、去背白底、左側速度線＋車底陰影。

**輪位換算**（遊戲內以 `BIKE.spriteW=64` 遊戲px 寬繪製，任何新車圖都要對齊這個比例）：
- 後輪中心：圖寬 15.6%、圖高 71%
- 前輪中心：圖寬 84.4%、圖高 71%
- 輪外徑：約圖寬 28%

新圖只要輪心位置比例對齊，物理零改動，直接套用現有 `spriteW`/`spriteOffsetX`/`spriteOffsetY` 邏輯（每台車可各自微調 offset 若構圖略有差異）。

## 2. 生圖 Prompt（共 10 台，直接複製給 Grok）

### 每次都先貼這段「共用規格」，再貼對應那台車的 STYLE 段落，並附上 `public/bike.png` 當範例圖

```
Use the attached image as an EXACT composition template. Generate a new
motorcycle in the SAME framing:

- Full side view facing RIGHT, no rider, no human.
- Same canvas aspect ratio as the reference (~3:2 landscape). Output at
  least 1024px wide.
- CRITICAL: both wheels must be in EXACTLY the same position and size as
  the reference — rear wheel center at 15.6% of image width, front wheel
  center at 84.4% of image width, both at 71% of image height, wheel
  diameter ≈ 28% of image width. Do not move, resize, or tilt the wheels.
- Same flat-vector / cel-shaded sticker art style as the reference: bold
  clean shapes, crisp dark outlines, smooth gradients, glowing neon rim
  accents on both wheels.
- Keep 2-3 horizontal neon speed-line streaks trailing behind the tail
  (left side), and a thin dark ground shadow ellipse under the wheels,
  same as reference.
- Plain pure-white background, nothing else in frame. No text, no logo,
  no watermark, no background scenery.
```

### 🏍️ 基本車款（2 台）——開局即有 / 低價金幣購買

**B1 街頭通勤「小白」**
```
STYLE: A friendly entry-level street motorcycle. Clean matte white and
light-gray fairing with subtle cyan pinstripes, simple round headlight,
minimal design, approachable and slightly cute proportions. Wheel rims
glow soft cyan. The "reliable first bike" — simple, tidy, unintimidating.
```

**B2 復古咖啡騎士**
```
STYLE: A retro cafe racer. Cream and burnt-orange two-tone fuel tank with
a thin gold stripe, brown leather single seat, round chrome headlight,
exposed engine block in dark gunmetal. Wheel rims glow warm amber instead
of cyan. Vintage 1970s soul rendered in the same neon-vector style.
```

### 🎯 任務解鎖車款（3 台）——成就綁定

**Q1 多頭鬥牛**（建議解鎖條件：大盤大漲日完賽累計 10 次）
```
STYLE: An aggressive "bull market" muscle bike. Deep crimson and scarlet
fairing shaped with sharp forward-charging lines, twin horn-like winglets
on the front cowl evoking bull horns, glowing red candlestick-chart motif
on the side panel, rising-arrow decal. Wheel rims glow fiery red-orange.
Embodiment of a raging bull market.
```

**Q2 空頭獵手**（建議解鎖條件：大盤大跌日完賽累計 10 次）
```
STYLE: A menacing "bear market" stealth hunter bike. Dark forest-green and
black fairing with claw-scratch decals, falling-arrow and inverted
candlestick-chart motif in toxic neon green on the side, angular predatory
silhouette. Wheel rims glow venom green. The bike that thrives when
markets bleed.
```

**Q3 不死鳥**（建議解鎖條件：連續參賽 streak 30 天）
```
STYLE: A mythical phoenix bike. Blazing orange-to-gold gradient fairing
with stylized flame feathers sweeping back from the front cowl along the
tail, ember particles, a phoenix-wing motif over the rear panel. Wheel
rims glow molten gold. Reward for riders who never miss a day — reborn
every morning.
```

### 💎 付費車款（5 台）——要好看到值得掏錢

**P1 赤紅暴走**（旗艦款）
```
STYLE: A legendary crimson cyberpunk superbike inspired by classic anime
aesthetics. Glossy candy-red full-fairing body with an elongated low-slung
silhouette, white accent panels, subtle warning-label decals, layered
aerodynamic cowling. Wheel rims glow intense red with a thin white inner
ring. Premium flagship presence — the coolest bike in the garage.
```

**P2 銀河鍍鉻**
```
STYLE: An iridescent chrome galaxy bike. Mirror-chrome fairing with a
holographic oil-slick rainbow sheen, deep-space nebula texture (purple and
blue with tiny stars) inside the body panels as if the bike contains a
galaxy, prismatic highlights. Wheel rims glow shifting violet-to-cyan
gradient. Ethereal, otherworldly, jewel-like.
```

**P3 黃金大亨**
```
STYLE: An opulent black-and-24k-gold luxury bike. Piano-black fairing with
polished gold trim lines, gold-plated engine block and exhaust, subtle
dollar/coin-pattern engraving on the side panel, diamond-stud headlight
accent. Wheel rims glow rich champagne gold. Unapologetic wealth — the
bike of someone who owns the leaderboard.
```

**P4 電馭武士**
```
STYLE: A cyber-samurai bike fusing feudal Japanese armor with high tech.
Layered fairing shaped like lacquered samurai plate armor in deep teal and
off-white, a katana-blade line running along the body, red tassel detail
at the tail, small rising-sun motif. Wheel rims glow icy teal with
kanji-style circuit etching. Disciplined, sharp, honorable.
```

**P5 幽靈匿蹤**
```
STYLE: A stealth phantom bike. Ultra-matte black angular faceted body like
a stealth fighter jet, barely-visible dark-gray panel lines, aggressive
low profile, thin blood-red underglow beneath the chassis and red
accent slits like narrowed eyes. Wheel rims glow deep red, dimmer and more
sinister than other bikes. Silent. Deadly. Almost invisible.
```

## 3. 生圖後驗收流程

1. Grok 產出後先去背（若非純白底需另外去背，跟現有 bike.png 一樣走透明 PNG）。
2. 疊回原圖，設 50% 透明度比對：輪心偏移應 ≤ 19px（原圖尺度，≈ 2 遊戲px），偏移過大要請 Grok 重生或手動微調 `spriteOffsetX/Y`。
3. 存放：`public/bikes/{id}.png`（例：`public/bikes/p1-crimson.png`），單檔壓到 150KB 內（跟現有 bike.png 251KB 同量級即可，用 tinypng 等工具壓）。
4. 每台車在程式碼登記一筆設定（實作時再定資料結構，大致長這樣）：
   ```ts
   { id: "p1-crimson", name: "赤紅暴走", src: "bikes/p1-crimson.png",
     spriteOffsetX: 0, spriteOffsetY: -2, tier: "paid", price: 199 }
   ```

## 4. 與留存系統的關係

車庫本身不是獨立功能，是**留存迴圈的解鎖出口**——任務車款對應每日任務/成就系統的獎勵，基本車款對應軟通貨經濟，付費車款是變現點。實作順序建議：

1. 先做軟通貨（金幣，來源＝每日任務/完賽）+ 選車 UI（哪怕只有目前這 1 台 + 色相偏移變體）
2. 兩台基本車款上線，開放金幣購買
3. 任務車款隨對應成就系統（streak/大盤事件計數）一起上線
4. 付費車款排最後，需要先接 Google Play Billing（IAP，見 CLAUDE.md 商業模式段落）

## 5. 免美術成本的過渡方案

在 AI 新圖到位前，可以先用**零成本的 canvas 色相偏移**做出 4~6 種配色變體（同一張 bike.png，`filter: hue-rotate()` 或 canvas globalCompositeOperation 上色），車尾霓虹拖尾／輪圈光暈換色，讓「車庫」頁面提前有東西可看、可解鎖，不用等美術素材到位才能上線第一版。
