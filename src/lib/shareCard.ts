// 分享成績圖卡（1080×1080 正方形，LINE/FB/IG 通吃）：
// 離屏 canvas 純程式繪製——深色霓虹底 + 當日走勢折線（漲紅/跌綠，與遊戲同語彙）
// + 大字分數 + 統計列 + 品牌 footer。輸出 PNG Blob 給 navigator.share files 用。

export interface ShareCardData {
  label: string;      // 股票代號
  name: string;       // 股票名稱
  subtitle?: string;  // 經典模式期間等
  prices: number[];
  score: number;
  timer: string;      // 已格式化 m:ss.s
  flips: number;
  perfect: number;
  finished: boolean;
}

const W = 1080;
const H = 1080;

export async function renderShareCard(d: ShareCardData): Promise<Blob | null> {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // 底：深色 + 網格
    ctx.fillStyle = "#05080f";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(45,226,230,0.07)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y <= H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    const centerX = W / 2;

    // 品牌標題
    ctx.textAlign = "center";
    ctx.fillStyle = "#2de2e6";
    ctx.shadowColor = "rgba(45,226,230,0.8)";
    ctx.shadowBlur = 24;
    ctx.font = "800 64px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText("TAIEX RIDER", centerX, 110);
    ctx.shadowBlur = 0;

    // 日期 + 標的
    const t = new Date();
    const dateStr = `${t.getFullYear()}/${String(t.getMonth() + 1).padStart(2, "0")}/${String(t.getDate()).padStart(2, "0")}`;
    ctx.fillStyle = "#cdd9e5";
    ctx.font = "500 40px 'Segoe UI', 'Microsoft JhengHei', sans-serif";
    ctx.fillText(`${d.label} ${d.name}`, centerX, 190);
    ctx.fillStyle = "#5c6b7a";
    ctx.font = "400 28px 'Segoe UI', sans-serif";
    ctx.fillText(d.subtitle ? d.subtitle : dateStr, centerX, 236);

    // 走勢折線（漲紅/跌綠 + 光暈），區域 90..990 x 290..560
    const p = d.prices;
    if (p.length >= 2) {
      const gx = 90, gw = W - 180, gy = 290, gh = 270;
      const min = Math.min(...p), max = Math.max(...p);
      const span = max - min || 1;
      const px = (i: number) => gx + (i / (p.length - 1)) * gw;
      const py = (v: number) => gy + gh - ((v - min) / span) * gh;
      // 開盤基準虛線
      ctx.strokeStyle = "rgba(205,217,229,0.25)";
      ctx.setLineDash([8, 8]);
      ctx.beginPath(); ctx.moveTo(gx, py(p[0])); ctx.lineTo(gx + gw, py(p[0])); ctx.stroke();
      ctx.setLineDash([]);
      // 分段上色
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      for (let i = 0; i < p.length - 1; i++) {
        const up = p[i + 1] >= p[i];
        ctx.strokeStyle = up ? "#ff2244" : "#00ff88";
        ctx.shadowColor = up ? "rgba(255,34,68,0.6)" : "rgba(0,255,136,0.6)";
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.moveTo(px(i), py(p[i]));
        ctx.lineTo(px(i + 1), py(p[i + 1]));
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    }

    // 結果 + 分數
    ctx.fillStyle = d.finished ? "#2de2e6" : "#ff4dff";
    ctx.font = "700 44px 'Segoe UI', 'Microsoft JhengHei', sans-serif";
    ctx.fillText(d.finished ? "🏁 完賽" : "💥 壯烈摔車", centerX, 660);

    ctx.fillStyle = "#ffb300";
    ctx.shadowColor = "rgba(255,179,0,0.7)";
    ctx.shadowBlur = 28;
    ctx.font = "800 128px 'Segoe UI', system-ui, sans-serif";
    const scoreText = `${d.score}`;
    const scoreW = ctx.measureText(scoreText).width;
    ctx.fillText(scoreText, centerX, 800);
    ctx.shadowBlur = 0;
    // 「分」小字貼在分數右側
    ctx.fillStyle = "#5c6b7a";
    ctx.font = "400 40px 'Segoe UI', 'Microsoft JhengHei', sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("分", centerX + scoreW / 2 + 14, 800);
    ctx.textAlign = "center";

    // 統計列
    ctx.fillStyle = "#cdd9e5";
    ctx.font = "500 36px 'Segoe UI', 'Microsoft JhengHei', sans-serif";
    ctx.fillText(`⏱ ${d.timer}　🌀 翻轉 ${d.flips} 圈　✨ 完美落地 ${d.perfect} 次`, centerX, 890);

    // footer
    ctx.fillStyle = "#5c6b7a";
    ctx.font = "400 30px 'Segoe UI', sans-serif";
    ctx.fillText("把台股走勢騎成霓虹賽道", centerX, 985);
    ctx.fillStyle = "#2de2e6";
    ctx.font = "600 32px 'Segoe UI', sans-serif";
    ctx.fillText("taiexrider.pages.dev", centerX, 1030);

    return await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
  } catch {
    return null; // 圖卡失敗 → caller fallback 純文字分享
  }
}
