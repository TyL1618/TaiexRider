import { useEffect, useState } from "react";
import Sparkline from "../components/Sparkline";
import { CLASSICS, classicToTrack } from "../data/classics";
import { fetchClassicRecords, type ClassicRecord } from "../lib/classicRecords";
import { classicPb, medalFor, nextMedalTarget, MEDAL_ICON } from "../lib/medals";
import { signInWithGoogle, type User } from "../lib/auth";
import type { TrackData } from "../data/tracks";
import "../TrackSelect.css";
import "./ClassicSelect.css";

const fmtMs = (ms: number) => {
  const s = ms / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, "0")}`;
};

const RANK_ICON = ["🥇", "🥈", "🥉"];

export default function ClassicSelect({
  user,
  onPick,
  onBack,
}: {
  user: User | null;
  onPick: (t: TrackData) => void;
  onBack: () => void;
}) {
  const [records, setRecords] = useState<Map<string, ClassicRecord[]>>(new Map());

  useEffect(() => {
    let alive = true;
    fetchClassicRecords().then((m) => { if (alive) setRecords(m); });
    return () => { alive = false; };
  }, []);

  return (
    <div className="select-screen">
      <button className="back-btn" onClick={onBack}>‹ 返回</button>
      <h1 className="select-title">經典模式</h1>
      <p className="classic-intro">歷史上著名的股市盤勢，化成賽道。每關留前 3 名紀錄。</p>

      {!user && (
        <div className="classic-login">
          <span className="classic-login-hint">登入後成績才會留下紀錄</span>
          <button className="google-signin-btn" onClick={signInWithGoogle}>
            <GoogleIcon />Google 登入
          </button>
        </div>
      )}

      <div className="track-list">
        {CLASSICS.map((c) => {
          const recs = records.get(c.id) ?? [];
          const pb = classicPb(c.id);
          const medal = medalFor(pb);
          const next = nextMedalTarget(pb);
          return (
            <button key={c.id} className="track-card classic-card" onClick={() => onPick(classicToTrack(c))}>
              <div className="classic-card-head">
                <span className="classic-title">
                  {medal && <span className="classic-medal">{MEDAL_ICON[medal]}</span>}
                  {c.title}
                </span>
                <span className="classic-period">{c.period}・{c.index}</span>
              </div>
              <Sparkline prices={c.prices} width={300} height={66} />
              <p className="classic-blurb">{c.blurb}</p>
              <div className="classic-medal-row">
                {pb > 0 ? <>我的最佳 {pb} 分</> : <>尚未通關</>}
                {next && <span className="cm-next">・目標 {MEDAL_ICON[next.medal]} {next.score}</span>}
                {!next && <span className="cm-next gold">・全獎牌達成！</span>}
              </div>
              <div className="classic-record">
                {recs.length > 0 ? (
                  recs.map((r, i) => (
                    <div key={i} className="classic-record-row">
                      {RANK_ICON[i]} <span className="cr-name">{r.player_name}</span>・{r.score} 分・{fmtMs(r.time_ms)}
                    </div>
                  ))
                ) : (
                  <span className="cr-empty">🏁 尚無紀錄・搶頭香</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 18 18" style={{ display: "inline", verticalAlign: "middle", marginRight: 5 }}>
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
    </svg>
  );
}
