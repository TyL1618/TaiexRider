// 成就金幣圖示：金色漸層硬幣 + 內嵌上揚走勢線（呼應遊戲主題），琥珀光暈。
// 取代原本誤用的機車 emoji，車庫/首頁共用。
export default function CoinIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      style={{ filter: "drop-shadow(0 0 4px rgba(255, 179, 0, 0.65))", flexShrink: 0 }}
    >
      <defs>
        <radialGradient id="coinFace" cx="35%" cy="28%" r="80%">
          <stop offset="0%" stopColor="#fff6da" />
          <stop offset="45%" stopColor="#ffcf4d" />
          <stop offset="100%" stopColor="#c9820a" />
        </radialGradient>
      </defs>
      <circle cx="20" cy="20" r="18" fill="url(#coinFace)" stroke="#7a4e02" strokeWidth="1.4" />
      <circle cx="20" cy="20" r="13.5" fill="none" stroke="#7a4e02" strokeWidth="1" opacity="0.45" />
      <polyline
        points="10,24 15,18 19,21 24,13 30,16"
        fill="none"
        stroke="#7a4e02"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.75"
      />
      <circle cx="30" cy="16" r="1.8" fill="#7a4e02" opacity="0.75" />
    </svg>
  );
}
