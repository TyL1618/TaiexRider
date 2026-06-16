import { useState, useMemo, useEffect, useRef } from "react";
import { TRACKS, trackDifficulty, difficultyStars, type TrackData } from "./data/tracks";
import { APP_VERSION, CHANGELOG } from "./version";
import "./TrackSelect.css";

type Mode = "monthly" | "intraday";
type SortBy = "popular" | "difficulty" | "code";

const SORT_LABELS: Record<SortBy, string> = {
  popular: "熱門",
  difficulty: "困難度",
  code: "股號",
};

// 熱門排名 = TRACKS 原始順序（之後可改成成交量 / 點擊數）
const POPULARITY = new Map(TRACKS.map((t, i) => [t.label, i]));

export default function TrackSelect({ onPick }: { onPick: (t: TrackData) => void }) {
  const [mode, setMode] = useState<Mode>("monthly");
  const [sortBy, setSortBy] = useState<SortBy>("popular");
  const [query, setQuery] = useState("");
  const [showLog, setShowLog] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showRank, setShowRank] = useState(false); // 排行榜佔位（discussion 第 14 點）
  const [confirmLeave, setConfirmLeave] = useState(false); // 裝置返回鍵離開確認（第 13 點）
  const leavingRef = useRef(false);

  // 攔截裝置返回鍵（Android/TWA）：首頁按返回 → 先問是否離開 App
  useEffect(() => {
    window.history.pushState({ taiexHome: true }, "");
    const onPop = () => {
      if (leavingRef.current) return; // 已確認離開 → 放行
      setConfirmLeave(true);
      window.history.pushState({ taiexHome: true }, ""); // 重新攔住
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const doLeave = () => {
    leavingRef.current = true;
    setConfirmLeave(false);
    window.history.go(-2); // 退出兩層 trap → 真正離開 App
  };

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = TRACKS.filter((t) => t.mode === mode);
    if (q) {
      out = out.filter(
        (t) => t.label.toLowerCase().includes(q) || t.name.toLowerCase().includes(q),
      );
    }
    out = [...out].sort((a, b) => {
      if (sortBy === "popular") return (POPULARITY.get(a.label) ?? 0) - (POPULARITY.get(b.label) ?? 0);
      if (sortBy === "difficulty") return trackDifficulty(b.prices) - trackDifficulty(a.prices);
      // 股號：數字小到大，TAIEX 等非數字排最後
      const na = Number(a.label);
      const nb = Number(b.label);
      if (isNaN(na) && isNaN(nb)) return a.label.localeCompare(b.label);
      if (isNaN(na)) return 1;
      if (isNaN(nb)) return -1;
      return na - nb;
    });
    return out;
  }, [mode, sortBy, query]);

  return (
    <div className="select-screen">
      <button className="corner-btn rank-btn" onClick={() => setShowRank(true)} aria-label="排行榜">
        🏆 排行榜
      </button>
      <button className="corner-btn settings-corner-btn" onClick={() => setShowSettings(true)} aria-label="設定">
        ⚙
      </button>

      <h1 className="select-title">TAIEX&shy;RIDER</h1>

      <div className="mode-tabs">
        <button
          className={`mode-tab ${mode === "monthly" ? "active" : ""}`}
          onClick={() => setMode("monthly")}
        >
          近月日線
          <span className="mode-tab-desc">50 個交易日收盤</span>
        </button>
        <button
          className={`mode-tab ${mode === "intraday" ? "active" : ""}`}
          onClick={() => setMode("intraday")}
        >
          前次日盤
          <span className="mode-tab-desc">盤中每 5 分鐘</span>
        </button>
      </div>

      <div className="toolbar">
        <input
          className="search-box"
          type="text"
          inputMode="numeric"
          placeholder="搜尋股號 / 名稱"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="sort-group">
          {(Object.keys(SORT_LABELS) as SortBy[]).map((s) => (
            <button
              key={s}
              className={`sort-btn ${sortBy === s ? "active" : ""}`}
              onClick={() => setSortBy(s)}
            >
              {SORT_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="track-list">
        {list.length === 0 ? (
          <p className="empty-hint">
            找不到「{query}」<br />
            <span className="empty-sub">目前僅收錄預抓股票，更多股號需待後端上線</span>
          </p>
        ) : (
          list.map((t) => (
            <button key={t.label} className="track-card" onClick={() => onPick(t)}>
              <div className="track-card-row">
                <span className="track-label">{t.label}</span>
                <span className="track-name">{t.name}</span>
                <span className="track-diff">{"★".repeat(difficultyStars(t.prices))}</span>
              </div>
              <span className="track-desc">{t.desc}</span>
            </button>
          ))
        )}
      </div>

      <p className="select-foot">純娛樂・非投資建議</p>

      {/* 設定面板：音量(待實作) + 版本 + 更新日誌入口 */}
      {showSettings && (
        <div className="log-overlay" onClick={() => setShowSettings(false)}>
          <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="log-title">設定</div>
            <div className="settings-item">音量（待實作）</div>
            <div className="settings-item dim">版本 v{APP_VERSION}</div>
            <button
              className="settings-link"
              onClick={() => {
                setShowSettings(false);
                setShowLog(true);
              }}
            >
              更新日誌 ›
            </button>
            <button className="log-close" onClick={() => setShowSettings(false)}>關閉</button>
          </div>
        </div>
      )}

      {/* 排行榜佔位：後端 / 每日挑戰上線後接 */}
      {showRank && (
        <div className="log-overlay" onClick={() => setShowRank(false)}>
          <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="log-title">排行榜</div>
            <div className="settings-item dim">敬請期待</div>
            <div className="settings-item dim" style={{ fontSize: "0.72rem", lineHeight: 1.6 }}>
              每日挑戰關卡上線後，<br />這裡會顯示當日成績排名
            </div>
            <button className="log-close" onClick={() => setShowRank(false)}>關閉</button>
          </div>
        </div>
      )}

      {/* 離開 App 確認（裝置返回鍵）*/}
      {confirmLeave && (
        <div className="log-overlay" onClick={() => setConfirmLeave(false)}>
          <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="log-title">離開遊戲？</div>
            <div className="settings-item dim">確定要離開 TAIEX RIDER 嗎？</div>
            <button className="log-close" onClick={doLeave}>確定離開</button>
            <button className="settings-link" onClick={() => setConfirmLeave(false)}>留下繼續玩</button>
          </div>
        </div>
      )}

      {showLog && (
        <div className="log-overlay" onClick={() => setShowLog(false)}>
          <div className="log-panel" onClick={(e) => e.stopPropagation()}>
            <div className="log-title">更新日誌</div>
            <div className="log-scroll">
              {CHANGELOG.map((entry) => (
                <div key={entry.date} className="log-entry">
                  <div className="log-date">{entry.date}</div>
                  <ul className="log-notes">
                    {entry.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <button className="log-close" onClick={() => setShowLog(false)}>關閉</button>
          </div>
        </div>
      )}
    </div>
  );
}
