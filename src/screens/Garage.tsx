import { useEffect, useState } from "react";
import { BIKE_SKINS, getCoins, getDiamonds, getTickets, isOwned, getActiveSkinId, purchaseSkin, setActiveSkin, addCoins, earnCoins, earnViaTicket, walletSpendItem, getActiveCosmetic, setActiveCosmetic, unlockAchievementSkin, syncWalletFromServer, fetchDailyUsage, writeDiamondsCache, getAdsRemoved, markAdsRemoved, type BikeSkin } from "../lib/garage";
import { requestRewardedAd, preloadRewardedAd } from "../lib/ads";
import { AD_COIN_REWARD, MAX_AD_COIN_CLAIMS_PER_DAY, getAdCoinClaims, incrementAdCoinClaims, setAdCoinClaims } from "../lib/adRewards";
import { getAchievementBikes, getAchievementTitles, type AchvBikeView, type AchvTitleView } from "../lib/achievements";
import { getStreak } from "../lib/streak";
import { resolveSessionDate } from "../lib/dailyMap";
import { isBillingAvailable, fetchPackPrices, purchaseDiamondPack, purchaseRemoveAds, reconcilePurchases, getLastPurchaseError, getPriceDiag, DIAMOND_PACKS, REMOVE_ADS_SKU } from "../lib/billing";
import { dailyKey } from "../data/pick";
import CoinIcon from "../components/CoinIcon";
import type { User } from "../lib/auth";
import "../TrackSelect.css";
import "./Garage.css";

// 鑽石車款（P 系列）5 台已全數生圖完成，皆已登記進 garage.ts 的
// BIKE_SKINS（currency:"diamond"），走一般購買流程，不再需要「敬請期待」佔位卡。

// 個人化裝備（LOTTERY_DESIGN.md §4）：稱號/暱稱顏色/前綴圖示/尾焰特效顏色/鬼影顏色。
// 價格白名單要跟 supabase migration_20260721.sql 的 wallet_spend_item() 同步，
// 這裡改價格記得也要改 SQL。price:-1＝不可購買，只能靠抽獎轉輪贈送（黑天鵝專屬）。
type CosmeticKind = "title" | "nickcolor" | "badge" | "trail" | "ghostcolor";
interface CosmeticOption { id: string; label: string; price: number; swatch?: string }
const COSMETIC_CATALOG: Record<CosmeticKind, CosmeticOption[]> = {
  nickcolor: [
    { id: "nickcolor:neon-cyan", label: "霓虹青", price: 50, swatch: "#2de2e6" },
    { id: "nickcolor:amber-gold", label: "琥珀金", price: 50, swatch: "#ffb300" },
    { id: "nickcolor:danger-red", label: "危險紅", price: 80, swatch: "#ff4d5e" },
    { id: "nickcolor:deep-purple", label: "深邃紫", price: 80, swatch: "#8855ff" },
    { id: "nickcolor:ghost-gray", label: "幽靈灰", price: 100, swatch: "#9aa0a6" },
    { id: "nickcolor:black-gold", label: "黑金", price: 250, swatch: "#caa25c" },
  ],
  // 2026-07-21 改版：可購買的稱號改成純粹好玩、跟遊戲實力無關的股市梗，售價
  // 統一 200 鑽——原本規劃可花錢買的「連勝狂魔/排行榜常客/空中飛人/地心引力
  // 挑戰者/完美落地大師」使用者拍板改成成就解鎖（不可購買，見下方
  // ACHIEVEMENT_TITLE_IDS 與 achievements.ts getAchievementTitles()）。
  title: [
    { id: "title:newbie-knight", label: "新手騎士", price: 200 },
    { id: "title:taiex-god", label: "台股股神", price: 200 },
    { id: "title:shoeshine-boy", label: "擦鞋童", price: 200 },
    { id: "title:shoeshine-chairman", label: "擦鞋董", price: 200 },
    { id: "title:bull-bear-clash", label: "多空交戰", price: 200 },
    { id: "title:park-homeless", label: "公園街友", price: 200 },
    { id: "title:finance-haojiao", label: "財經皓角", price: 200 },
    { id: "title:chives", label: "韭菜", price: 200 },
    { id: "title:fourth-institution", label: "第四大法人", price: 200 },
    { id: "title:blackswan-witness", label: "黑天鵝目擊者", price: -1 },
  ],
  badge: [
    { id: "badge:fire", label: "🔥", price: 80 },
    { id: "badge:star", label: "⭐", price: 80 },
    { id: "badge:crown", label: "👑", price: 150 },
    { id: "badge:diamond", label: "💎", price: 150 },
    { id: "badge:motorcycle", label: "🏍️", price: 100 },
    { id: "badge:blackswan", label: "🦢", price: -1 },
  ],
  trail: [
    { id: "trail:amber", label: "琥珀", price: 80, swatch: "#ffb300" },
    { id: "trail:magenta", label: "洋紅", price: 80, swatch: "#ff5fa8" },
    { id: "trail:green", label: "綠", price: 80, swatch: "#4caf50" },
    { id: "trail:white", label: "白", price: 100, swatch: "#ffffff" },
  ],
  ghostcolor: [
    { id: "ghostcolor:amber", label: "琥珀", price: 80, swatch: "#ffb300" },
    { id: "ghostcolor:magenta", label: "洋紅", price: 80, swatch: "#ff5fa8" },
    { id: "ghostcolor:green", label: "綠", price: 80, swatch: "#4caf50" },
    { id: "ghostcolor:white", label: "白", price: 100, swatch: "#ffffff" },
  ],
};
const COSMETIC_SECTION_LABEL: Record<CosmeticKind, string> = {
  title: "稱號", nickcolor: "暱稱顏色", badge: "前綴圖示", trail: "尾焰特效顏色", ghostcolor: "鬼影顏色",
};

export default function Garage({ user, onBack }: { user: User | null; onBack: () => void }) {
  const [coins, setCoins] = useState(() => getCoins());
  const [diamonds, setDiamonds] = useState(() => getDiamonds());
  const [tickets, setTickets] = useState(() => getTickets());
  const [active, setActive] = useState(() => getActiveSkinId(user?.id ?? null));
  const [watchingAd, setWatchingAd] = useState(false);
  const [showAdTicketPrompt, setShowAdTicketPrompt] = useState(false);
  const [adClaims, setAdClaims] = useState(() => getAdCoinClaims(dailyKey(), user?.id ?? null));
  const [achvBikes, setAchvBikes] = useState<AchvBikeView[]>(() => getAchievementBikes(0));
  const [achvTitles, setAchvTitles] = useState<AchvTitleView[]>(() => getAchievementTitles(0));
  const [billingAvailable] = useState(() => isBillingAvailable());
  const [packPrices, setPackPrices] = useState<Map<string, string>>(new Map());
  const [purchasingSku, setPurchasingSku] = useState<string | null>(null);
  const [adsRemoved, setAdsRemoved] = useState(() => getAdsRemoved());
  const [purchasingAdsRemoval, setPurchasingAdsRemoval] = useState(false);
  const [buyError, setBuyError] = useState("");
  const [priceDiag, setPriceDiag] = useState("");
  const [priceLoading, setPriceLoading] = useState(false);
  const [adNotice, setAdNotice] = useState("");
  const [, forceRender] = useState(0);

  // 鑽石購買 + 永久去廣告：只有 Android TWA + 瀏覽器支援 Digital Goods API 才顯示
  // （網頁版不開放購買）。就算兩者都成立，Play Console 商品尚未建立前查價也會失敗，
  // 卡片會顯示「暫無法購買」。
  // 查價（+查完對帳）。抽成函式，讓「進車庫自動查」跟「手動重試按鈕」共用。
  // clientAppUnavailable 這類 Chrome↔App billing 連線間歇失敗時，手動重試往往比反覆
  // 重開 App 更有效（重開反而把 Chrome 連線池弄得更不穩）。
  const loadPrices = async () => {
    if (!billingAvailable || !user) return; // 訪客不查價/不對帳（沒帳號可入帳）
    setPriceLoading(true);
    setBuyError("");
    const m = await fetchPackPrices([...DIAMOND_PACKS.map((p) => p.sku), REMOVE_ADS_SKU]);
    setPackPrices(m);
    setPriceDiag(m.size === 0 ? getPriceDiag() : "");
    setPriceLoading(false);
    const r = await reconcilePurchases();
    // 對帳若有孤兒交易補發失敗，把 Edge Function 的具體原因顯示出來（免再買一筆就能看到）。
    const err = getLastPurchaseError();
    if (err) setBuyError(err);
    if (!r) return;
    if (typeof r.diamonds === "number") { writeDiamondsCache(r.diamonds); setDiamonds(r.diamonds); }
    if (r.adsRemoved) { markAdsRemoved(); setAdsRemoved(true); }
  };

  useEffect(() => {
    if (!billingAvailable || !user) return;
    void loadPrices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billingAvailable, user?.id]);

  const handleBuyDiamonds = async (sku: string) => {
    if (purchasingSku) return;
    setBuyError("");
    setPurchasingSku(sku);
    const result = await purchaseDiamondPack(sku);
    setPurchasingSku(null);
    if (result !== null) { writeDiamondsCache(result); setDiamonds(result); }
    else { setBuyError(getLastPurchaseError()); }
  };

  const handleBuyRemoveAds = async () => {
    if (purchasingAdsRemoval || adsRemoved) return;
    setBuyError("");
    setPurchasingAdsRemoval(true);
    const ok = await purchaseRemoveAds();
    setPurchasingAdsRemoval(false);
    if (ok) { markAdsRemoved(); setAdsRemoved(true); }
    else { setBuyError(getLastPurchaseError()); }
  };

  // Q 系列 streak 進度依「目前這一期」session key 讀（連假整段算同一期，跟 DailyChallenge 同源）
  const refreshAchvBikes = async (checkAlive: () => boolean) => {
    const key = await resolveSessionDate(dailyKey());
    if (!checkAlive()) return;
    const streakDays = getStreak(key);
    setAchvBikes(getAchievementBikes(streakDays));
    setAchvTitles(getAchievementTitles(streakDays));
  };
  useEffect(() => {
    let alive = true;
    refreshAchvBikes(() => alive);
    // 進車庫就在背景把「看廣告拿金幣」的廣告備好，使用者點下去時幾乎瞬開（見 ads.ts）。
    preloadRewardedAd("coin");
    return () => { alive = false; };
  }, []);

  // 掛載時把伺服器錢包（金幣/鑽石/擁有清單/成就進度/streak）同步進本地快取——換裝置/
  // 換帳號登入或清過 localStorage 時，車庫畫面才不會卡在舊值，也不會卡在裝置上殘留的
  // 另一個帳號的成就進度（見 garage.ts syncWalletFromServer 註解）。同步完後重讀一次
  // achvBikes，避免畫面短暫顯示同步前的舊快取。
  useEffect(() => {
    let alive = true;
    syncWalletFromServer().then(async () => {
      if (!alive) return;
      setCoins(getCoins());
      setDiamonds(getDiamonds());
      setTickets(getTickets());
      setAdsRemoved(getAdsRemoved());
      setActive(getActiveSkinId(user?.id ?? null)); // 帳號隔離：換帳號要重讀這個帳號自己的裝備車
      await refreshAchvBikes(() => alive);
      if (alive) forceRender((n) => n + 1);
    });
    // 看廣告次數同樣以伺服器為準：本地計數被清掉（清除資料/重裝/換殼換 origin）時，
    // 畫面會顯示「還能再看 2 次」但伺服器記得已領滿，玩家看完廣告拿不到錢
    // （2026-07-10 真機實測，見 migration_20260710.sql）。訪客拿到 null，沿用本地計數。
    fetchDailyUsage().then((usage) => {
      if (!alive || !usage) return;
      setAdCoinClaims(dailyKey(), user?.id ?? null, usage.adClaims);
      setAdClaims(getAdCoinClaims(dailyKey(), user?.id ?? null));
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // 成就達成＋美術已到位（BIKE_SKINS 有登記對應 id）就自動解鎖擁有，不用另外按按鈕
  // （unlockAchievementSkin 本身冪等，重複呼叫不影響已擁有狀態；已登入時會走伺服器 RPC）。
  // ⚠️ unlockAchievementSkin 寫完快取不帶 React state，必須手動 forceRender 一次，
  // 不然畫面會停在舊的「購買」按鈕，直到別的地方剛好觸發重繪。
  useEffect(() => {
    let alive = true;
    (async () => {
      let changed = false;
      for (const a of achvBikes) {
        if (a.unlocked && BIKE_SKINS.some((s) => s.id === a.id) && !isOwned(a.id)) {
          await unlockAchievementSkin(a.id);
          changed = true;
        }
      }
      // 稱號成就（連勝狂魔/排行榜常客/空中飛人/地心引力挑戰者/完美落地大師）不是
      // 車皮，沒有「美術到位」這個前提，達標就直接解鎖（unlockAchievementSkin 通用
      // 呼叫 wallet_unlock_achievement RPC，白名單見 migration_20260721e.sql）。
      for (const t of achvTitles) {
        if (t.unlocked && !isOwned(t.id)) {
          await unlockAchievementSkin(t.id);
          changed = true;
        }
      }
      if (changed && alive) forceRender((n) => n + 1);
    })();
    return () => { alive = false; };
  }, [achvBikes, achvTitles]);

  const handleBuy = async (id: string) => {
    if (await purchaseSkin(id)) {
      setCoins(getCoins());
      setDiamonds(getDiamonds());
      forceRender((n) => n + 1);
    }
  };

  const grantAdCoins = () => {
    setAdNotice("");
    incrementAdCoinClaims(dailyKey(), user?.id ?? null);
    setAdClaims(getAdCoinClaims(dailyKey(), user?.id ?? null));
    setCoins(addCoins(AD_COIN_REWARD));
    // granted===false：伺服器明確拒絕（當日已達上限）。earnCoins 已把餘額覆寫回真實值，
    // 這裡把畫面次數也校正成滿檔並說明原因——否則玩家只看到金幣閃一下就消失、沒有
    // 任何提示，體感像是被吃錢（2026-07-10 真機實測回報）。
    // granted===null（未登入/RPC 失敗/DB 還沒跑 migration）維持原本「樂觀值先頂著」行為。
    earnCoins("ad").then((granted) => {
      setCoins(getCoins());
      if (granted === false) {
        setAdCoinClaims(dailyKey(), user?.id ?? null, MAX_AD_COIN_CLAIMS_PER_DAY);
        setAdClaims(MAX_AD_COIN_CLAIMS_PER_DAY);
        setAdNotice("今日領取次數已用完，明天再來");
      }
    });
  };

  const proceedWithAd = () => {
    setWatchingAd(true);
    requestRewardedAd("coin").then((ok) => {
      setWatchingAd(false);
      if (ok) grantAdCoins();
    });
  };

  const handleWatchAd = () => {
    if (watchingAd || adClaims >= MAX_AD_COIN_CLAIMS_PER_DAY) return;
    // 已買永久去廣告：不用看廣告，點擊直接領取（比照看廣告復活/雙倍金幣的既有作法）
    if (adsRemoved) {
      grantAdCoins();
      return;
    }
    // 有票券：先問要不要消耗一張跳過廣告直接領取（LOTTERY_DESIGN.md §6）
    if (tickets > 0) {
      setShowAdTicketPrompt(true);
      return;
    }
    proceedWithAd();
  };

  // 票券消耗＝直接呼叫 wallet_earn_via_ticket，伺服器一次做完「扣票券+發金幣」，
  // 跟看廣告共用同一組每日上限（wallet_earn_log kind='ad'），不會多領。
  const useTicketForCoins = async () => {
    setShowAdTicketPrompt(false);
    const ok = await earnViaTicket("ad");
    setTickets(getTickets());
    setCoins(getCoins());
    if (ok) {
      incrementAdCoinClaims(dailyKey(), user?.id ?? null);
      setAdClaims(getAdCoinClaims(dailyKey(), user?.id ?? null));
    } else {
      setAdNotice("今日領取次數已用完，明天再來");
    }
  };

  const handleEquip = (id: string) => {
    if (setActiveSkin(id, user?.id ?? null)) setActive(id);
  };

  // 個人化裝備：未擁有→購買（走 wallet_spend_item RPC，跟車款分開一支，見
  // garage.ts 註解）；已擁有→點擊切換裝備/取消裝備（同一項再點一次＝取消裝備，
  // 回到「無」，跟車皮裝備不同——這幾類本來就允許「不裝備任何一個」）。
  const handleCosmeticClick = async (kind: CosmeticKind, opt: CosmeticOption) => {
    if (opt.price < 0) return; // 不可購買（黑天鵝專屬贈品）
    if (!isOwned(opt.id)) {
      if (diamonds < opt.price) return;
      const ok = await walletSpendItem(opt.id);
      if (ok) { setDiamonds(getDiamonds()); forceRender((n) => n + 1); }
      return;
    }
    const current = getActiveCosmetic(kind, user?.id ?? null);
    setActiveCosmetic(kind, current === opt.id ? null : opt.id, user?.id ?? null);
    forceRender((n) => n + 1);
  };

  const renderSkinCard = (s: BikeSkin) => {
    const owned = isOwned(s.id);
    const equipped = active === s.id;
    const currency = s.currency ?? "coin";
    const balance = currency === "diamond" ? diamonds : coins;
    const afford = balance >= s.price;
    return (
      <div key={s.id} className={`garage-card${equipped ? " equipped" : ""}`}>
        <div className="garage-preview">
          <img
            src={`${import.meta.env.BASE_URL}${s.src ?? "bike.png"}`}
            alt={s.name}
            style={{ filter: !s.src && s.hueRotateDeg !== 0 ? `hue-rotate(${s.hueRotateDeg}deg)` : undefined }}
          />
        </div>
        <div className="garage-card-body">
          <div className="garage-card-name">{s.name}{equipped && <span className="garage-equipped-tag">使用中</span>}</div>
          <div className="garage-card-desc">{s.desc}</div>
          {owned ? (
            <button
              className={`garage-btn${equipped ? " disabled" : ""}`}
              disabled={equipped}
              onClick={() => handleEquip(s.id)}
            >
              {equipped ? "使用中" : "裝備"}
            </button>
          ) : (
            <button
              className={`garage-btn buy${currency === "diamond" ? " buy-diamond" : ""}${afford ? "" : " disabled"}`}
              disabled={!afford}
              onClick={() => handleBuy(s.id)}
            >
              購買・{s.price} {currency === "diamond" ? "鑽石" : "金幣"}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="select-screen garage-screen">
      <button className="back-btn" onClick={onBack}>‹ 返回</button>
      <h1 className="select-title">車庫</h1>
      <p className="garage-coins"><CoinIcon size={22} /> 金幣 {coins}</p>
      <p className="garage-coins garage-diamonds">💎 鑽石 {diamonds}</p>
      <p className="garage-coins garage-tickets">🎫 票券 {tickets}</p>
      <p className="garage-intro">完賽/摔車與每日任務都能賺金幣，解鎖車皮換上場</p>
      {!user && (
        <p className="garage-guest-notice">⚠️ 訪客進度僅存於本機，清除資料或換裝置會遺失。登入 Google 可雲端保存</p>
      )}
      <button
        className="garage-ad-btn"
        disabled={watchingAd || adClaims >= MAX_AD_COIN_CLAIMS_PER_DAY}
        onClick={handleWatchAd}
      >
        {watchingAd
          ? "廣告播放中…"
          : adClaims >= MAX_AD_COIN_CLAIMS_PER_DAY
            ? "今日已達上限"
            : adsRemoved
              ? `🎁 領取 +${AD_COIN_REWARD} 金幣 (${adClaims}/${MAX_AD_COIN_CLAIMS_PER_DAY})`
              : `📺 看廣告 +${AD_COIN_REWARD} 金幣 (${adClaims}/${MAX_AD_COIN_CLAIMS_PER_DAY})`}
      </button>
      {adNotice && <p className="garage-ad-notice">{adNotice}</p>}

      {showAdTicketPrompt && (
        <div className="modal-overlay" onClick={() => setShowAdTicketPrompt(false)}>
          <div className="slot-result" onClick={(e) => e.stopPropagation()}>
            <div className="garage-card-name">🎫 要消耗一張票券，跳過廣告直接領取嗎？</div>
            <div className="slot-result-actions">
              <button className="modal-btn" onClick={useTicketForCoins}>消耗票券直接領取</button>
              <button className="modal-link" onClick={() => { setShowAdTicketPrompt(false); proceedWithAd(); }}>還是看廣告</button>
            </div>
          </div>
        </div>
      )}

      <div className="garage-list">
        {BIKE_SKINS.filter((s) => !s.locked && s.currency !== "diamond").map(renderSkinCard)}
      </div>

      <h2 className="garage-section-title">🎯 成就車款</h2>
      <div className="garage-list">
        {achvBikes.map((a) => {
          const skin = BIKE_SKINS.find((s) => s.id === a.id);
          if (a.unlocked && skin) return renderSkinCard(skin); // 美術已到位＋達成→直接當一般車皮卡片可裝備
          return (
            <div key={a.id} className={`garage-card locked${a.unlocked ? " achv-done" : ""}`}>
              <div className="garage-preview garage-preview-locked">
                <span className="garage-lock-icon">{a.unlocked ? "🏆" : "🔒"}</span>
              </div>
              <div className="garage-card-body">
                <div className="garage-card-name">{a.name}</div>
                <div className="garage-card-desc">{a.desc}</div>
                <div className="achv-progress-track">
                  <div className="achv-progress-fill" style={{ width: `${(a.progress / a.target) * 100}%` }} />
                </div>
                <div className="achv-progress-text">
                  {a.unlocked ? "已達成・車皮製作中，敬請期待" : `${a.progress} / ${a.target}`}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 稱號成就（2026-07-21 改版）：連勝狂魔/排行榜常客/空中飛人/地心引力挑戰者/
          完美落地大師——跟 Q 系列車款一樣達標自動解鎖，不可購買（花錢買的稱號改成
          下面「個人化裝備」區塊那批股市梗）。未解鎖顯示進度條，解鎖後可直接裝備。 */}
      <h2 className="garage-section-title">🎯 成就稱號</h2>
      <div className="garage-list">
        {achvTitles.map((t) => {
          if (t.unlocked) {
            const equipped = getActiveCosmetic("title", user?.id ?? null) === t.id;
            return (
              <div key={t.id} className={`garage-card locked achv-done`}>
                <div className="garage-preview garage-preview-locked">
                  <span className="garage-lock-icon">🏆</span>
                </div>
                <div className="garage-card-body">
                  <div className="garage-card-name">{t.name}{equipped && <span className="garage-equipped-tag">使用中</span>}</div>
                  <div className="garage-card-desc">{t.desc}</div>
                  <button
                    className={`garage-btn${equipped ? " disabled" : ""}`}
                    disabled={equipped}
                    onClick={() => { setActiveCosmetic("title", t.id, user?.id ?? null); forceRender((n) => n + 1); }}
                  >
                    {equipped ? "使用中" : "裝備"}
                  </button>
                </div>
              </div>
            );
          }
          return (
            <div key={t.id} className="garage-card locked">
              <div className="garage-preview garage-preview-locked">
                <span className="garage-lock-icon">🔒</span>
              </div>
              <div className="garage-card-body">
                <div className="garage-card-name">{t.name}</div>
                <div className="garage-card-desc">{t.desc}</div>
                <div className="achv-progress-track">
                  <div className="achv-progress-fill" style={{ width: `${(t.progress / t.target) * 100}%` }} />
                </div>
                <div className="achv-progress-text">{t.progress} / {t.target}</div>
              </div>
            </div>
          );
        })}
      </div>

      <h2 className="garage-section-title">💎 鑽石車款</h2>
      <div className="garage-list">
        {BIKE_SKINS.filter((s) => s.currency === "diamond").map(renderSkinCard)}
      </div>

      {/* 隱藏車款（黑天鵝，LOTTERY_DESIGN.md §3）：只能靠抽獎轉輪取得，不開放直接
          購買。取得前顯示全黑剪影 + 神秘符號，不像成就車款有進度條（純機率，沒有
          「進度」這個概念）。 */}
      <h2 className="garage-section-title">🖤 隱藏車款</h2>
      <div className="garage-list">
        {BIKE_SKINS.filter((s) => s.id === "hidden-blackswan").map((s) => {
          if (isOwned(s.id)) return renderSkinCard(s);
          return (
            <div key={s.id} className="garage-card locked garage-card-mystery">
              <div className="garage-preview garage-preview-locked">
                <img
                  src={`${import.meta.env.BASE_URL}${s.src}`}
                  alt="???"
                  className="garage-silhouette-img"
                />
                <span className="garage-lock-icon">❓</span>
              </div>
              <div className="garage-card-body">
                <div className="garage-card-name">？？？</div>
                <div className="garage-card-desc">萬中無一的異象——只能靠抽獎轉輪取得</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 個人化裝備（LOTTERY_DESIGN.md §4）：稱號/暱稱顏色/前綴圖示/尾焰特效顏色/
          鬼影顏色，花鑽石購買，訪客沒有伺服器鑽石可花，這區只給已登入玩家看。 */}
      {user && (
        <>
          <h2 className="garage-section-title">🎨 個人化裝備</h2>
          {(Object.keys(COSMETIC_CATALOG) as CosmeticKind[]).map((kind) => {
            const activeId = getActiveCosmetic(kind, user.id);
            return (
              <div key={kind} className="cosmetic-row">
                <div className="cosmetic-row-label">{COSMETIC_SECTION_LABEL[kind]}</div>
                <div className="cosmetic-chip-list">
                  {COSMETIC_CATALOG[kind].map((opt) => {
                    const owned = isOwned(opt.id);
                    const equipped = activeId === opt.id;
                    const exclusive = opt.price < 0;
                    const afford = diamonds >= opt.price;
                    return (
                      <button
                        key={opt.id}
                        className={`cosmetic-chip${equipped ? " equipped" : ""}${!owned && (exclusive || !afford) ? " disabled" : ""}`}
                        disabled={exclusive && !owned}
                        onClick={() => handleCosmeticClick(kind, opt)}
                        title={owned ? opt.label : exclusive ? `${opt.label}（抽獎專屬）` : `${opt.label} · ${opt.price} 鑽石`}
                      >
                        {opt.swatch && <span className="cosmetic-swatch" style={{ background: opt.swatch }} />}
                        <span>{opt.label}</span>
                        {!owned && !exclusive && <span className="cosmetic-price">{opt.price}💎</span>}
                        {!owned && exclusive && <span className="cosmetic-price">🔒</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </>
      )}

      {/* 未登入玩家：TWA 支援購買但沒有帳號可入帳，一律不顯示購買按鈕（billing.ts 也在
          付款前再擋一層），改顯示登入提示，避免訪客扣了錢卻無處發放。 */}
      {billingAvailable && !user && (
        <>
          <h2 className="garage-section-title">💰 購買鑽石</h2>
          <div style={{
            margin: "0 0 12px", padding: "12px 14px", borderRadius: 10,
            background: "rgba(120,170,255,0.1)", border: "1px solid rgba(120,170,255,0.4)",
            color: "#bcd4ff", fontSize: 13, lineHeight: 1.6,
          }}>
            🔒 請先登入 Google 帳號才能購買鑽石與永久去廣告——訪客的購買記錄只存在本機、
            換裝置就消失，無法保存，因此暫不開放。
          </div>
        </>
      )}

      {billingAvailable && user && (
        <>
          <h2 className="garage-section-title">💰 購買鑽石</h2>
          {(buyError || priceDiag) && (
            <div style={{
              margin: "0 0 12px", padding: "10px 14px", borderRadius: 10,
              background: "rgba(255,80,80,0.12)", border: "1px solid rgba(255,80,80,0.45)",
              color: "#ff9d9d", fontSize: 13, lineHeight: 1.5, wordBreak: "break-word",
            }}>
              <div>⚠️ {buyError || priceDiag}</div>
              {priceDiag && !buyError && (
                <button
                  onClick={() => { void loadPrices(); }}
                  disabled={priceLoading}
                  style={{
                    marginTop: 8, padding: "6px 16px", borderRadius: 8,
                    background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,157,157,0.5)",
                    color: "#ffd0d0", fontSize: 13, cursor: "pointer",
                  }}
                >
                  {priceLoading ? "查詢中…" : "🔄 重試"}
                </button>
              )}
            </div>
          )}
          <div className="garage-list">
            {DIAMOND_PACKS.map((p) => {
              const price = packPrices.get(p.sku);
              return (
                <div key={p.sku} className="garage-card diamond-pack-card">
                  <div className="garage-card-body">
                    <div className="garage-card-name">💎 {p.diamonds} 鑽石</div>
                    <div className="garage-card-desc">{p.label}</div>
                    <button
                      className={`garage-btn buy-diamond${!price ? " disabled" : ""}`}
                      disabled={!price || purchasingSku !== null}
                      onClick={() => handleBuyDiamonds(p.sku)}
                    >
                      {purchasingSku === p.sku ? "處理中…" : price ?? "暫無法購買"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <h2 className="garage-section-title">🚫 永久去除廣告</h2>
          <div className="garage-list">
            <div className="garage-card diamond-pack-card">
              <div className="garage-card-body">
                <div className="garage-card-name">🚫 永久去除廣告</div>
                <div className="garage-card-desc">
                  一次購買終身有效：復活、每日拿金幣、每日排名賽額外挑戰機會，全部不再需要看廣告
                </div>
                {adsRemoved ? (
                  <button className="garage-btn disabled" disabled>已購買</button>
                ) : (
                  <button
                    className={`garage-btn buy-diamond${!packPrices.get(REMOVE_ADS_SKU) ? " disabled" : ""}`}
                    disabled={!packPrices.get(REMOVE_ADS_SKU) || purchasingAdsRemoval}
                    onClick={handleBuyRemoveAds}
                  >
                    {purchasingAdsRemoval ? "處理中…" : packPrices.get(REMOVE_ADS_SKU) ?? "暫無法購買"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
