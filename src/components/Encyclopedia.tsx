import { useEffect, useMemo, useState } from "react";
import { fetchStockRegistry, getCollectedCodes, type RegistryEntry } from "../lib/collection";
import "./Encyclopedia.css";

type Filter = "all" | "collected" | "uncollected";
type SortDir = "asc" | "desc";

const FILTER_LABEL: Record<Filter, string> = { all: "全部", uncollected: "未收集", collected: "已收集" };

// 股票圖鑑彈窗（RETENTION_PLAN.md，2026-07-06/07 討論定案後動工）：
// 兩欄卡片、依代號排序、篩選未收集/已收集/全部，已收集打星星，絕版股票仍留著只是淡化顯示
// （絕版制：分母只增不減，見 migration_20260707.sql 開頭說明）。
export default function Encyclopedia({ onClose }: { onClose: () => void }) {
  const [registry, setRegistry] = useState<RegistryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [collected] = useState<Set<string>>(() => new Set(getCollectedCodes()));
  const [filter, setFilter] = useState<Filter>("all");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  useEffect(() => {
    let alive = true;
    fetchStockRegistry().then((rows) => {
      if (alive) { setRegistry(rows); setLoaded(true); }
    });
    return () => { alive = false; };
  }, []);

  // registry 本身已經是伺服器端 order=stock_code.asc，desc 只需反轉一次
  const list = useMemo(() => {
    let out = registry;
    if (filter === "collected") out = out.filter((r) => collected.has(r.stock_code));
    else if (filter === "uncollected") out = out.filter((r) => !collected.has(r.stock_code));
    return sortDir === "desc" ? [...out].reverse() : out;
  }, [registry, filter, sortDir, collected]);

  const collectedCount = registry.filter((r) => collected.has(r.stock_code)).length;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel log encyclopedia-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">📖 股票圖鑑</div>
        <div className="encyclopedia-summary">已收集 {collectedCount} / {registry.length} 支</div>

        <div className="encyclopedia-toolbar">
          <button className="ency-sort-btn" onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}>
            代號 {sortDir === "asc" ? "↑" : "↓"}
          </button>
          <div className="ency-filter-group">
            {(["all", "uncollected", "collected"] as Filter[]).map((f) => (
              <button
                key={f}
                className={`ency-filter-btn${filter === f ? " active" : ""}`}
                onClick={() => setFilter(f)}
              >
                {FILTER_LABEL[f]}
              </button>
            ))}
          </div>
        </div>

        <div className="log-scroll">
          <div className="encyclopedia-grid">
            {!loaded ? (
              <p className="ency-empty">載入中…</p>
            ) : list.length === 0 ? (
              <p className="ency-empty">沒有符合條件的股票</p>
            ) : (
              list.map((r) => {
                const isCollected = collected.has(r.stock_code);
                return (
                  <div
                    key={r.stock_code}
                    className={`ency-card${isCollected ? " collected" : ""}${r.delisted ? " delisted" : ""}`}
                  >
                    {isCollected && <span className="ency-star">⭐</span>}
                    <span className="ency-code">{r.stock_code}</span>
                    {r.delisted && <span className="ency-delisted-tag">絕版</span>}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <button className="modal-btn" onClick={onClose}>關閉</button>
      </div>
    </div>
  );
}
