// 隱藏統計頁（開發者專用）：設定視窗連點版本號 5 下開啟。
// 數據來自 admin_stats RPC——非 admin 帳號拿到 null，顯示無權限畫面。
import { useEffect, useState } from "react";
import { fetchAdminStats, type AdminStats } from "../lib/adminStats";
import "./StatsScreen.css";

export default function StatsScreen({ onClose }: { onClose: () => void }) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [state, setState] = useState<"loading" | "denied" | "ready">("loading");

  const load = () => {
    setState("loading");
    fetchAdminStats(14).then((s) => {
      if (s) { setStats(s); setState("ready"); }
      else setState("denied");
    });
  };
  useEffect(load, []);

  const modeName: Record<string, string> = {
    daily: "每日排名賽", slot: "隨機拉霸", custom: "自選", long: "長征", classic: "經典",
  };

  return (
    <div className="stats-screen" onClick={(e) => e.stopPropagation()}>
      <div className="stats-head">
        <span className="stats-title">📊 營運數據（僅你可見）</span>
        <div>
          <button className="stats-btn" onClick={load}>↻</button>
          <button className="stats-btn" onClick={onClose}>✕</button>
        </div>
      </div>

      {state === "loading" && <div className="stats-msg">載入中…</div>}
      {state === "denied" && (
        <div className="stats-msg">
          無法取得數據：需以開發者帳號登入，且 Supabase 已跑過 migration_20260702b.sql。
        </div>
      )}

      {state === "ready" && stats && (
        <div className="stats-body">
          <div className="stats-section">每日總覽（近 14 天）</div>
          <table className="stats-table">
            <thead><tr><th>日期</th><th>DAU</th><th>開局</th><th>完賽</th><th>死亡</th><th>分享</th><th>復活</th></tr></thead>
            <tbody>
              {stats.daily.map((r) => (
                <tr key={r.d}>
                  <td>{r.d.slice(5)}</td><td>{r.dau}</td><td>{r.runs}</td>
                  <td>{r.finishes}</td><td>{r.deaths}</td><td>{r.shares}</td><td>{r.revives}</td>
                </tr>
              ))}
              {stats.daily.length === 0 && <tr><td colSpan={7}>尚無數據</td></tr>}
            </tbody>
          </table>

          <div className="stats-section">模式分佈（近 14 天開局）</div>
          <table className="stats-table">
            <tbody>
              {Object.entries(stats.modes).sort((a, b) => b[1] - a[1]).map(([m, n]) => (
                <tr key={m}><td>{modeName[m] ?? m}</td><td>{n}</td></tr>
              ))}
              {Object.keys(stats.modes).length === 0 && <tr><td>尚無數據</td></tr>}
            </tbody>
          </table>

          <div className="stats-section">死亡原因</div>
          <table className="stats-table">
            <tbody>
              {Object.entries(stats.deathCauses).sort((a, b) => b[1] - a[1]).map(([c, n]) => (
                <tr key={c}><td>{c === "topHit" ? "翻車撞地" : c === "stuckMidAir" ? "卡死保底" : c}</td><td>{n}</td></tr>
              ))}
              {Object.keys(stats.deathCauses).length === 0 && <tr><td>尚無數據</td></tr>}
            </tbody>
          </table>

          <div className="stats-section">次日留存</div>
          <table className="stats-table">
            <thead><tr><th>首玩日</th><th>新裝置</th><th>隔日回訪</th><th>留存率</th></tr></thead>
            <tbody>
              {stats.retention.map((r) => (
                <tr key={r.d0}>
                  <td>{r.d0.slice(5)}</td><td>{r.new}</td><td>{r.retained}</td>
                  <td>{r.new > 0 ? Math.round((r.retained / r.new) * 100) : 0}%</td>
                </tr>
              ))}
              {stats.retention.length === 0 && <tr><td colSpan={4}>尚無數據</td></tr>}
            </tbody>
          </table>

          <div className="stats-foot">events 總筆數 {stats.totalEvents}・產生於 {new Date(stats.generatedAt).toLocaleString()}</div>
        </div>
      )}
    </div>
  );
}
