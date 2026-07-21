# TaiexRider 車庫系統設計（2026-07-03 定案方向）

> 目標：解決「目前只有一台車，玩家沒有長期收集/解鎖動力」的問題。
> 技術前提：物理體（圓形車身 r=10 + 兩個輪子 r=6）與貼圖完全分離——**換車皮只是換一張 PNG，不動物理/手感/難度/排行榜公平性**。
> **狀態更新（2026-07-03，v0.12.19）：B1/B2 兩台基本車款已是正式圖，非過渡色**。使用者用 Grok 生成 → 自己手動去背 → 交給 Claude 量測輪圈色塊中心點（`scripts` 暫存腳本，未進版控）換算成 `spriteW`/`spriteOffsetX`/`spriteOffsetY`，讓兩個輪子精準對齊物理輪位，登記進 `src/lib/garage.ts` 的 `BIKE_SKINS`（`b2-cafe-racer`／`b1-street-white`，各 80 金幣）。**流程已驗證可行**，剩下 Q1~Q3（任務解鎖）+ P1~P5（付費）8 台照同一套流程處理即可：Grok 生圖 → 去背 → 量輪圈色塊座標 → 算 offset → 登記清單。原圖存放在 `public/bikes/raw/`（已 `.gitignore`，不進版控），成品在 `public/bikes/`。
> **狀態更新（2026-07-03 稍晚，v0.12.23）：Q2/Q3 已量測登記上線，Q1 卡關**。使用者在舊版 prompt（本次改寫前）已用 Grok 生出 Q1~Q3 三張圖。量測方式＝Node+sharp 掃描高亮高飽和像素找輪圈色塊（`scripts/_tmp_measureWheels.mjs`，量完即刪未進版控），debug 疊圖用 Read 工具直接看圖驗證抓得準不準。
> - **q2-bear（空頭獵手）**：毒液綠輪圈跟暗綠/黑車身色相區隔夠大，色塊偵測乾淨，量測結果可信。已登記上線。
> - **q3-phoenix（不死鳥）**：金色輪圈跟「熔金鳳凰」車身同色系，前輪量測受車體火焰裝飾污染，cyPct 用後輪對稱值人工校正（非純自動算出）。已登記上線但**⚠️ 真機/可見視窗需比對輪子是否貼地，可能要再微調 offsetY**。
> - **q1-bull（多頭鬥牛）✅ 2026-07-03 深夜已登記上線**：改良版 prompt（明講禁側箱/panniers+chart 圖案移到油箱+輪圈金色）重生兩次才成功（第一次跑出 123RF 圖庫浮水印，判斷是生圖模型記憶體洩漏，重生一次就消失；第二次仍是側箱擋輪，判斷是「chart on side panel」措辭跟側箱造型互相誘發，改成禁側箱的硬性條件+chart 畫在油箱上才解決）。最終版兩輪色塊偵測乾淨、跟規格座標誤差 <2%（量測結果見下方 BIKE_SKINS 註解）。
> **狀態更新（2026-07-04，v0.12.26）：原圖來源改為三個版控資料夾，取代 `public/bikes/raw/`**。
> 前情提要：v0.12.26 曾嘗試寫自動去背腳本重跑全部車皮，結果把圖弄壞，6 分鐘內整包 revert（`c84f3f7`→`90d1247`）。
> 使用者之後手動處理圖檔、重新建立更嚴格的資料夾規範，**這三個資料夾禁止 Claude 修改或覆蓋，只能讀取**：
> - `public/bikes/Grok_Original/`：Grok 生成的原始白底圖（JPEG），最上游來源。
> - `public/bikes/For_Lobby/`：使用者手動去背，**保留車底陰影**，給首頁高解析展示框（`bikes/hires/`）用。
> - `public/bikes/For_Gaming/`：使用者手動去背＋**去除車底陰影**，給遊戲內貼圖（`spriteW`/`offsetX`/`offsetY` 對齊物理輪位）用。
> 三個資料夾都已進版控（不再 gitignore）——先前 `raw/` 沒進版控，一旦處理壞掉就無法復原，這次改保留原圖避免重蹈覆轍。
> 量測方式也改良：用 OpenCV `HoughCircles` 直接在 alpha 遮罩上偵測兩個輪胎圓（純幾何、不吃顏色），車身裝飾跟輪圈同色系（q1/q3 都踩過這雷）也不受影響。offsetY 的地板間隙補償從憑經驗的固定值，改成用「量到的輪胎視覺半徑 − 物理 wheelRadius=6」算出來的精確值。B1/B2/Q1/Q2/Q3 五台＋新增的 P1/P2 都已重新處理上線。
> **狀態更新（2026-07-04 晚，v0.12.27~28）：P1/P2 正式開放測試＋伺服器端錢包上線**。車款分級改版：
> B1/B2 從免費改回金幣購買（200/150 金幣）；新增「鑽石」軟通貨，P1 赤紅暴走／P2 銀河鍍鉻用
> 同一套 OpenCV 量測後正式可購買/裝備（300/380 鑽石，暫定佔位價，車庫「鑽石車款」區塊，
> 取代原本的「付費車款」名稱與 disabled 佔位卡）；P3~P5 尚未生圖仍「敬請期待」。
> **2026-07-06 更新：真錢 IAP 已正式上線**——鑽石購買頁（`diamonds_100/350/1200`，NT$30/90/270）
> 已在 Play Console 建立並啟用，玩家現在可以花台幣購買鑽石，不再只靠開發者測試帳號補滿；
> 同時新增「永久去除廣告」（`remove_ads_forever`，非消耗型，NT$69）。金幣/鑽石/擁有清單已改接伺服器端 RPC（`supabase/migration_20260705.sql`，見
> [WALLET_PLAN.md](WALLET_PLAN.md)），localStorage 不再是唯一權威來源。
> **狀態更新（2026-07-06）**：Q 系列成就進度（大漲/大跌完賽次數、streak）與暱稱也一併搬進
> 資料庫（`supabase/migration_20260706.sql`），修復同裝置切換 Google 帳號互相污染的問題，
> 詳見 §4 車款分級「Q（任務解鎖款）」段落與 [WALLET_PLAN.md](WALLET_PLAN.md)。
> **狀態更新（2026-07-07）：P3~P5 三台鑽石車款全數生圖完成上線，鑽石車款十台正式集滿**。
> P3 黃金大亨（黑金 bagger，鞍囊掛在後輪上方、輪子完整露出無遮擋）／P4 電馭武士（青白配色，
> 冰藍電路紋輪圈，日式重機造型）／P5 幽靈匿蹤（黑車身+血紅發光輪圈）。量測方式同 P1/P2：
> OpenCV HoughCircles 抓 `For_Gaming/` alpha 遮罩兩個輪胎圓，三台偵測都乾淨（P3 甚至只抓到
> 兩個候選圓，無其他誤判候選；P4/P5 各多一個頭燈誤判候選，人工比對 y 座標排除）。已登記進
> `garage.ts`（`p3-gold`/`p4-samurai`/`p5-phantom`，450/520/600 鑽石暫定佔位價）、
> Garage.tsx 移除「敬請期待」佔位卡、伺服器端 `wallet_spend_skin()` 白名單同步更新
> （`supabase/migration_20260707b.sql`，**✅ 已跑**，後續 `migration_20260707c.sql`
> 重排定價時再次 create-or-replace 覆蓋為新價格）。
> **✅ 2026-07-07 真機回報**：P3 黃金大亨從高處衝下時比其他車款更容易視覺上「卡進」K棒與
> K棒間的縫隙（車身擠入、放開油門又擠出，車頭朝向也會短暫擠一下）。使用者確認**不影響
> 遊玩**（v0.12.13 的卡縫自動脫困 watchdog 照常運作），只是「違反常理」的視覺違和感，
> **判斷不是這台特有的 bug，是所有車款共通的物理現象**（隱形小碰撞體＋較寬車貼圖的既有
> 落差，見 DEVDOC.md §5.4b）在**視覺較寬、bagger 造型較「胖」的車款上更顯眼**而已。
> **使用者明確表示先不處理**，之後若要根治可考慮收斂胖車款的視覺寬度或加強脫困動畫平滑度。
> **💡 未來構想（2026-07-07 討論，尚未排入待辦，只是記著）**：後續 P6/P7 或額外成就車款
> 可以走「跑跑卡丁車後期怪奇車型」路線（毛筆、棒棒糖、足球門這類完全不像交通工具的造型），
> 不必受「兩輪必須露出、對齊物理輪位」這條規則限制——反正物理判定跟貼圖本來就完全脫鉤
> （見文件開頭第 4 行），怪奇車型貼圖只要整體比例/重心合理即可，不需要畫出任何輪子，
> 也能省掉每次跟 Grok 拉鋸「側箱不要擋輪子」的麻煩。話題性也是賣點。
> **狀態更新（2026-07-07 下午）：P 系列重新排序定價+兩台改名**。使用者拍板銀河鍍鉻不該是
> 最便宜（380）——改成赤紅暴走300／電馭武士380／黃金期貨450（原黃金大亨）／匿蹤幽靈520
> （原幽靈匿蹤）／銀河鍍鉻600（現在最貴）。id 不動只調陣列順序+價格，避免動到既有擁有清單/
> 白名單 key。伺服器白名單同步（`supabase/migration_20260707c.sql`，跟本頁上面幾條 P3~P5
> 白名單更新是同一份延續，這次疊加價格重排）。Q3「不死鳥」也改名「火鳳凰」（`achievements.ts`
> 獨立宣告的名稱要記得一起改，跟 `garage.ts` 是兩處各自維護）。

---

## 1. 技術規格（給 Grok 生圖用，也是未來實作對照表）

現有原圖：`public/bike.png`，**610×409 px**，側視朝右、無騎士、去背白底、左側速度線＋車底陰影。

**輪位換算**（遊戲內以 `BIKE.spriteW=64` 遊戲px 寬繪製，任何新車圖都要對齊這個比例）：
- 後輪中心：圖寬 15.6%、圖高 71%
- 前輪中心：圖寬 84.4%、圖高 71%
- 輪外徑：約圖寬 28%

新圖只要輪心位置比例對齊，物理零改動，直接套用現有 `spriteW`/`spriteOffsetX`/`spriteOffsetY` 邏輯（每台車可各自微調 offset 若構圖略有差異）。

## 2. 生圖 Prompt（共 10 台，直接複製給 Grok）

### ✅ B1/B2/Q1/Q2/Q3/P1/P2/P3/P4/P5 十台全數上線

Q1 多頭鬥牛已於 2026-07-03 深夜補生成功（過程見文件開頭狀態更新：第一次撞到生圖模型
記憶體洩漏跑出圖庫浮水印、第二次側箱擋輪，第三版禁側箱+chart 移到油箱才成功）。
P1/P2 已於 2026-07-04 晚正式開放測試，P3~P5 已於 2026-07-07 生圖完成上線（見上方狀態更新）。
下面「P3~P5」那幾段 STYLE 皆已成功生圖，留著備查不用再動；Q1/P1/P2 同理。

**Q1 最終成功版 prompt**（備查，不用再重生，除非之後想換款式）：

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
- The overall body silhouette / vehicle type must look CLEARLY DIFFERENT
  from the reference and from other bikes in this set — only the wheel
  positions and size are locked, everything else about the frame, tank,
  seat, and proportions should follow that bike's own STYLE description
  below.
- STRICTLY EXCLUDE anything beyond the motorcycle itself: NO motion/speed
  lines, NO exhaust flames or smoke, NO ground shadow or reflection, NO
  particles, sparks, or glow trails floating off the bike. The motorcycle
  silhouette is the only thing allowed to touch the canvas edges of
  content — everything else stays pure white.
- Plain pure-white background, nothing else in frame. No text, no logo,
  no watermark, no background scenery.

VEHICLE TYPE: American muscle cruiser — SHORT wheelbase (compact, not a
touring bike), forward-mounted foot pegs, wide flat handlebars, chunky low
seat. NO saddlebags, NO panniers, NO hard luggage cases, NO windshield/
fairing, NO long touring bodywork of any kind over or beside the rear
wheel. Both wheels must be FULLY exposed and unobstructed — no bodywork,
fender, or accessory may cover any part of either wheel; a viewer must be
able to see the complete circular rim and tire of both wheels with
nothing overlapping them.
STYLE: An aggressive "bull market" muscle cruiser. Deep crimson and
scarlet fuel tank shaped with sharp forward-charging lines, twin horn-like
winglets on the front fender evoking bull horns, a glowing red candlestick-
chart motif with a rising-arrow painted directly ON THE FUEL TANK (not on
any side panel or luggage). Wheel rims glow bright GOLD, clearly a
different color from the crimson body so the glowing rim reads as a
distinct bright ring against the dark red bodywork (not another shade of
red/orange). Embodiment of a raging, prosperous bull market.
```

生完先丟 `public/bikes/Grok_Original/`，使用者手動去背成 `public/bikes/For_Lobby/`（留車底陰影）＋ `public/bikes/For_Gaming/`（去車底陰影）兩份 → 跟 Claude 說一聲即可重跑量測流程登記上線（流程見文件開頭 2026-07-04 狀態更新）。

---

### 以下是 P1~P5（付費車款）留著之後生圖用，B/Q 系列的完整 STYLE 段落也留著備查（都已生成過，不用重貼）

### 每次都先貼這段「共用規格」，再貼對應那台車的 STYLE 段落，並附上 `public/bike.png` 當範例圖

> **⚠️ 已知限制（2026-07-07 使用者回報）：目前為止 7 台全部生出來都帶車底陰影**，即使
> prompt 早就寫了「NO ground shadow or reflection」。這是圖像生成模型的通病——訓練資料
> 幾乎全是「有光影的實拍照片」，模型會自動幫物體加「接地陰影」讓畫面看起來更真實，
> 純文字否定很難 100% 蓋掉這個傾向；且陰影常常跟輪胎同色系（灰/黑），去背時色塊法很難
> 把陰影跟輪胎邊緣切乾淨。下面已經把否定句改寫得更具體（描述「陰影長什麼樣子」而不是
> 只講「不要陰影」，理論上能降低出現機率），但**心理預期上仍要抓「大機率還是會有，去背
> 時照舊流程手動處理」**，不要因為又出現陰影就以為 prompt 沒改對。
>
> **另一個容易被忽略的衝突**：凡是要求車輪「完全不能被任何東西遮住」的規則，如果同一段
> STYLE 又要求側箱/長軸距車殼「蓋在後輪上方」，兩者會互相打架（Q1 多頭鬥牛就是因為這樣
> 重生兩次才成功）。這條規則已經從只放在 Q1 那台，搬進下面「共用規格」讓每一台都套用，
> **貼 STYLE 段落前自己检查一下該台的描述有沒有讓車殼/側箱蓋到輪胎**（P3 黃金大亨的
> 「saddle-bag humps」已經預先改成不擋輪，其餘車款若之後想加類似配件也要注意）。

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
- Both wheels must be FULLY exposed and unobstructed — no bodywork,
  fender, saddlebag, luggage case, or accessory of any kind may cover or
  overlap any part of either wheel. A viewer must be able to trace the
  complete circular rim and tire of both wheels with nothing in front of
  or behind them.
- Same flat-vector / cel-shaded sticker art style as the reference: bold
  clean shapes, crisp dark outlines, smooth gradients, glowing neon rim
  accents on both wheels.
- The overall body silhouette / vehicle type must look CLEARLY DIFFERENT
  from the reference and from other bikes in this set — only the wheel
  positions and size are locked, everything else about the frame, tank,
  seat, and proportions should follow that bike's own STYLE description
  below.
- STRICTLY EXCLUDE anything beyond the motorcycle itself: NO motion/speed
  lines, NO exhaust flames or smoke, NO particles, sparks, or glow trails
  floating off the bike.
- ABSOLUTELY NO ground contact shadow of any kind: do NOT render a dark
  ellipse, blurred gray/black patch, gradient, or any darkening of the
  white background directly beneath either tire. Treat the background as
  a completely flat, shadeless white void — like a 2D vector sticker
  cut out and placed on a blank canvas, not a photo of an object sitting
  under a light source. The white area under and around the wheels must
  be pixel-identical to the white area everywhere else in the background.
- The motorcycle silhouette is the only thing allowed to touch the canvas
  edges of content — everything else stays pure white. No text, no logo,
  no watermark, no background scenery.
```

### 🏍️ 基本車款（2 台）——開局即有 / 低價金幣購買

**B1 街頭通勤「小白」**
```
VEHICLE TYPE: modern commuter scooter (step-through scooter frame, not a
motorcycle) — the odd one out silhouette in this whole set.
STYLE: A friendly entry-level scooter. Clean matte white and light-gray
body with subtle cyan pinstripes, simple round headlight, minimal design,
approachable and slightly cute proportions. Wheel rims glow soft cyan.
The "reliable first bike" — simple, tidy, unintimidating.
```

**B2 復古咖啡騎士**
```
VEHICLE TYPE: classic cafe racer — flat low handlebars, exposed round fuel
tank, no fairing/cowling.
STYLE: A retro cafe racer. Cream and burnt-orange two-tone fuel tank with
a thin gold stripe, brown leather single seat, round chrome headlight,
exposed engine block in dark gunmetal. Wheel rims glow warm amber instead
of cyan. Vintage 1970s soul rendered in the same neon-vector style.
```

### 🎯 任務解鎖車款（3 台）——成就綁定

**Q1 多頭鬥牛**（建議解鎖條件：大盤大漲日完賽累計 10 次）
```
VEHICLE TYPE: American muscle cruiser — SHORT wheelbase (compact, not a
touring bike), forward-mounted foot pegs, wide flat handlebars, chunky low
seat. NO saddlebags, NO panniers, NO hard luggage cases, NO windshield/
fairing, NO long touring bodywork of any kind over or beside the rear
wheel. Both wheels must be FULLY exposed and unobstructed — no bodywork,
fender, or accessory may cover any part of either wheel; a viewer must be
able to see the complete circular rim and tire of both wheels with
nothing overlapping them.
STYLE: An aggressive "bull market" muscle cruiser. Deep crimson and
scarlet fuel tank shaped with sharp forward-charging lines, twin horn-like
winglets on the front fender evoking bull horns, a glowing red candlestick-
chart motif with a rising-arrow painted directly ON THE FUEL TANK (not on
any side panel or luggage). Wheel rims glow bright GOLD, clearly a
different color from the crimson body so the glowing rim reads as a
distinct bright ring against the dark red bodywork (not another shade of
red/orange). Embodiment of a raging, prosperous bull market.
```

**Q2 空頭獵手**（建議解鎖條件：大盤大跌日完賽累計 10 次）
```
VEHICLE TYPE: supermoto / dirt bike — tall thin skeletal frame, high front
fender, long travel suspension look, upright narrow silhouette.
STYLE: A menacing "bear market" stealth hunter bike. Dark forest-green and
black bodywork with claw-scratch decals, falling-arrow and inverted
candlestick-chart motif in toxic neon green on the side, angular predatory
silhouette. Wheel rims glow venom green. The bike that thrives when
markets bleed.
```

**Q3 不死鳥**（建議解鎖條件：連續參賽 streak 30 天）
```
VEHICLE TYPE: neo-retro naked street bike — round headlight, rounded fuel
tank, exposed engine, upright riding stance (no fairing).
STYLE: A mythical phoenix bike. Blazing orange-to-gold gradient bodywork
with stylized flame feathers sweeping back from the tank along the tail,
a phoenix-wing motif over the rear fender. Wheel rims glow molten gold.
Reward for riders who never miss a day — reborn every morning.
```

### 💎 付費車款（5 台）——要好看到值得掏錢

**P1 赤紅暴走**（旗艦款）
```
VEHICLE TYPE: full-fairing sportbike — aggressive aerodynamic cowling,
low clip-on handlebars, sharp angular fairing panels.
STYLE: A legendary crimson cyberpunk sportbike inspired by classic anime
aesthetics. Glossy candy-red full-fairing body with an elongated low-slung
silhouette, white accent panels, subtle warning-label decals, layered
aerodynamic cowling. Wheel rims glow intense red with a thin white inner
ring. Premium flagship presence — the coolest bike in the garage.
```

**P2 銀河鍍鉻**
```
VEHICLE TYPE: futuristic concept tourer — smooth enclosed bodywork panels
covering most of the frame, minimal visible mechanical parts, sleek pod-
like silhouette.
STYLE: An iridescent chrome galaxy concept bike. Mirror-chrome enclosed
bodywork with a holographic oil-slick rainbow sheen, deep-space nebula
texture (purple and blue with tiny stars) visible through translucent
panels as if the bike contains a galaxy, prismatic highlights. Wheel rims
glow shifting violet-to-cyan gradient. Ethereal, otherworldly, jewel-like.
```

**P3 黃金大亨**
```
VEHICLE TYPE: luxury touring bagger — long wheelbase, large front fairing
with windscreen, plush wide seat. The bodywork between the seat and the
rear wheel may bulge outward for a saddlebag-like silhouette, but this
bulge must stay entirely ABOVE the rear wheel's horizontal centerline and
must not extend down over, in front of, or behind the wheel itself —
both wheels stay fully round and unobstructed, same rule as every other
bike in this set.
STYLE: An opulent black-and-24k-gold luxury tourer. Piano-black bodywork
with polished gold trim lines, gold-plated engine block and exhaust,
subtle dollar/coin-pattern engraving on the side panel, diamond-stud
headlight accent. Wheel rims glow rich champagne gold. Unapologetic
wealth — the bike of someone who owns the leaderboard.
```

**P4 電馭武士**
```
VEHICLE TYPE: naked streetfighter with armor-plated bodywork — angular
layered plates over the tank and side panels, upright stance, exposed
front forks.
STYLE: A cyber-samurai bike fusing feudal Japanese armor with high tech.
Layered bodywork shaped like lacquered samurai plate armor in deep teal
and off-white, a katana-blade line running along the body, red tassel
detail at the tail, small rising-sun motif. Wheel rims glow icy teal with
kanji-style circuit etching. Disciplined, sharp, honorable.
```

**P5 幽靈匿蹤**
```
VEHICLE TYPE: minimalist tracker/bobber — stripped-down frame, short
fenderless tail, compact round-ish tank, low narrow profile.
STYLE: A stealth phantom bobber. Ultra-matte black angular faceted
bodywork, barely-visible dark-gray panel lines, aggressive low profile,
thin blood-red underglow beneath the chassis and red accent slits like
narrowed eyes. Wheel rims glow deep red, dimmer and more sinister than
other bikes. Silent. Deadly. Almost invisible.
```

### 🖤 隱藏車款（2 台）——抽獎轉輪專屬，**尚未生圖（0/2）**

不走一般車庫購買，只能靠 [LOTTERY_DESIGN.md](LOTTERY_DESIGN.md) 的抽獎轉輪抽到，
定位比 P 系列更稀有。跟前面十台一樣，生圖時要先貼「共用規格」段落（附上
`public/bike.png` 當範例圖），再貼下面對應那台的 STYLE。

**黑天鵝**（`hidden-blackswan`，抽中機率 0.05%，見 `lottery_spin()` 機率表）
```
VEHICLE TYPE: elegant low sport-cruiser with a long, low, gracefully
curving tail section evoking a swan's folded neck — NOT a full-fairing
sportbike, NOT a bagger/tourer. Slim, sinuous silhouette.
STYLE: An ominous, mythical "black swan event" bike. Obsidian-black
lacquered bodywork with a subtle iridescent oil-slick sheen (shifting
hints of deep purple and green in the black, like real black swan
feathers catching light), fine feather-texture etching sweeping back
along the tank and tail. Thin cracks of glowing blood-red light break
through the seams of the bodywork as if something catastrophic is
happening beneath the surface — small, contained, not a full glow, just
hairline fractures of red. A single thin gold accent line traces along
the top of the tank evoking a swan's beak. Wheel rims glow deep
crimson-gold, dimmer and more ominous than any other bike's rim glow —
clearly distinct from P3's bright champagne gold. Absolutely no ground
shadow beneath the chassis — the bike should look like it's floating on
pure white, not sitting on a surface. This is the rarest, most unsettling
bike in the garage: the day the market broke.
```

**看不見的手**（id 待定，構想車款，尚未排進機率表，跟使用者確認要不要正式排入
抽獎後再補登記）——刻意違反共用規格裡「要有完整車身輪廓」的預設，需要額外覆蓋
指示：
```
VEHICLE TYPE: a motorcycle where the ENTIRE body, frame, tank, seat, and
fairing are 100% invisible/transparent — render NOTHING for the bodywork,
as if the frame is made of glass with a refractive index of exactly 1.0
(completely see-through, not frosted or tinted). ONLY the two wheels
(tires + rims) are visible, held in their exact locked positions as if
by an invisible frame — do not draw any connecting structure, axle line,
or frame silhouette between them, not even a faint outline. The wheels
should appear to float independently in their correct fixed spots with
empty white space between and around them.
STYLE: "The Invisible Hand" — a nod to Adam Smith's economic theory, the
market force nobody can see but that moves everything. Only the two
wheels exist: glossy black tires with sharp tread detail, chrome-silver
rims with spoke detail, glowing icy-white rim light (distinct from every
other bike's colored glow — this one is pure white/silver, cold and
clinical). No bodywork of any kind, no ghost outline, no faint silhouette
hint — total invisibility of everything except the two wheels. Absolutely
no ground contact shadow beneath either wheel or in the empty space
between them — pure flat white background with zero shading anywhere,
including where a body would normally cast a shadow. This should look
unmistakably like just two wheels floating on a blank white canvas with
nothing else present.
```

⚠️ 「看不見的手」生圖風險較高——生圖模型通常很難真的畫出「什麼都沒有」，可能會
偷畫出淡淡的車身輪廓或連接線殘留，收圖後要仔細檢查，必要時要求重畫或手動去背
修掉殘留痕跡。黑天鵝風險較低，是「有車身、只是配色詭異」的正常類型，跟其他車
一樣的處理流程即可。

## 3. 生圖後驗收流程

1. Grok 產出後先去背（若非純白底需另外去背，跟現有 bike.png 一樣走透明 PNG）。
2. 疊回原圖，設 50% 透明度比對：輪心偏移應 ≤ 19px（原圖尺度，≈ 2 遊戲px），偏移過大要請 Grok 重生或手動微調 `spriteOffsetX/Y`。
   **⚠️ 2026-07-03 追加**：AI 生圖的輪胎視覺半徑常比物理輪子（`wheelRadius=6`）大一圈，
   輪心對齊後輪胎底部仍會視覺穿進地板線。量完輪心 offset 後，再依 spriteW 等比多補
   `-2` 上下的 offsetY（往上）當地板間隙緩衝（b1/b2 已按此追加，未真機驗證手感，
   之後量 Q/P 系列時比照辦理，真機試玩若還會陷或變成明顯懸空再微調）。
3. 存放：`public/bikes/{id}.png`（例：`public/bikes/p1-crimson.png`），單檔壓到 150KB 內（跟現有 bike.png 251KB 同量級即可，用 tinypng 等工具壓）。
4. 每台車在程式碼登記一筆設定（實作時再定資料結構，大致長這樣）：
   ```ts
   { id: "p1-crimson", name: "赤紅暴走", src: "bikes/p1-crimson.png",
     spriteOffsetX: 0, spriteOffsetY: -2, tier: "paid", price: 199 }
   ```

## 4. 與留存系統的關係

車庫本身不是獨立功能，是**留存迴圈的解鎖出口**。**車款分級定案（2026-07-04 使用者更新拍板，取代 2026-07-03 舊版，已寫進 `garage.ts`）**：

- **B（基本款）＝金幣購買**：`b2-cafe-racer` 200 金幣／`b1-street-white` 150 金幣（2026-07-03 曾一度改免費，2026-07-04 使用者拍板收回改回金幣購買）。
- **Q（任務解鎖款）＝成就條件解鎖**，明確**不是**金幣/鑽石購買——大漲/大跌完賽次數與連續參賽天數達標即可解鎖。2026-07-06 起，這些進度已改為伺服器端權威（`player_achievements`/`player_streak` 表，`achievements.ts`/`streak.ts` 的 localStorage 只當顯示快取），`wallet_unlock_achievement` RPC 也改成伺服器自行驗證門檻是否真的達標，不再信任客戶端宣稱——舊版（v1）信任客戶端曾導致同裝置切換 Google 帳號互相污染，見 [WALLET_PLAN.md](WALLET_PLAN.md) 2026-07-06 段落。
- **P（鑽石車款）＝走真錢 IAP**（Google Play Billing，**2026-07-06 已正式上線**）：P1 300 鑽石／P2 380 鑽石（車款本身鑽石售價未變）。**鑽石購買頁已上線**（`diamonds_100/350/1200` 三個 SKU id，消耗型 IAP），玩家不再只能靠開發者測試帳號補滿；同時上線「永久去除廣告」（`remove_ads_forever`，非消耗型，見 History.md「📦 已封存文件：NEXT_BATCH_PLAN.md」批次 4）。
> **2026-07-11 定價定案（取代上面 07-06 的暫定佔位價）**：內容物 100/350/**1300**
> （大包 1200→1300，SKU id 不變，`migration_20260711b.sql`）。使用者已在 Play
> Console 手動改好三包售價、vc25 已審核上架。
> **2026-07-11 晚間二次微調（實測 Console 售價 ≠ 玩家實際看到的顯示價，含稅）**：
> 使用者發現 Console 輸入 30 元、玩家實際看到 31 元（+1 元稅差），回推調整 Console
> 輸入值讓**顯示價**精準落在整數：`diamonds_100` 顯示 30 元（Console 輸入 29）／
> `diamonds_350` 顯示 90 元（輸入 86）／`diamonds_1200` 顯示 290 元（輸入 279）／
> `remove_ads_forever` 顯示 **80 元**（輸入 76，原訂 72 元不動已被取代，去廣告漲價）。
> 之後所有文件/程式碼註解提到售價，一律指玩家實際看到的顯示價（30/90/290/80）。

金幣/鑽石（軟通貨）與車皮擁有清單已於 2026-07-04 晚改接伺服器端錢包（`supabase/migration_20260705.sql` + `garage.ts`），已登入玩家的餘額/擁有清單以伺服器為權威，localStorage 只當顯示快取，詳見 [WALLET_PLAN.md](WALLET_PLAN.md)。

實作順序：
1. ✅ 軟通貨（金幣，來源＝每日任務/完賽）+ 選車 UI 已上線
2. ✅ 兩台基本車款已上線且免費
3. 任務車款隨對應成就系統（streak/大盤事件計數）一起上線，機制待設計
4. 付費車款排最後，需要先接 Google Play Billing（IAP，見 CLAUDE.md 商業模式段落）

## 5. 免美術成本的過渡方案

在 AI 新圖到位前，可以先用**零成本的 canvas 色相偏移**做出 4~6 種配色變體（同一張 bike.png，`filter: hue-rotate()` 或 canvas globalCompositeOperation 上色），車尾霓虹拖尾／輪圈光暈換色，讓「車庫」頁面提前有東西可看、可解鎖，不用等美術素材到位才能上線第一版。
