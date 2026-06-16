export const APP_VERSION = "0.3.0";

export interface ChangelogEntry {
  date: string;
  notes: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: "2026-06-16",
    notes: [
      "修正陡坡飛出前車身抖動（chassis 改圓形物理體）",
      "修正翻車死不了、自動翻正（翻倒 1 秒判死）",
      "完美落地判斷改用坡面中點，依翻圈數計分（×100）",
      "首頁新增更新日誌",
      "結算畫面隱藏 HUD（設定鈕、返回鈕、距離）",
    ],
  },
  {
    date: "2026-06-16 (早)",
    notes: [
      "移除 boost 系統，定速街機模型（地面 = 空中 = 固定速）",
      "重力 0.5 + 速度 ×1.2",
      "修正車體從地形接縫穿落（chassis mask:0 → 圓形碰撞體）",
      "結算迷你圖以開盤價為顏色基準，加虛線基準線",
    ],
  },
  {
    date: "2026-06-15",
    notes: [
      "機車貼圖（bike.png）上線",
      "吸地消彈跳、低重力、空中翻轉手感大調整",
      "V 谷平底插入，地形接縫法線偏移修正",
    ],
  },
  {
    date: "2026-06-14",
    notes: [
      "真實股票賽道（TAIEX、2330、0050、2454）",
      "賽道選擇畫面上線",
      "PWA 骨架、霓虹標題、Canvas 物理引擎初版",
    ],
  },
];
