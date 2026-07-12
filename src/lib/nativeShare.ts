// 原生殼分享（Capacitor @capacitor/share + @capacitor/filesystem）。
//
// 為什麼要這支：Capacitor App 的 WebView（Android System WebView）對
// navigator.share() 的支援不穩定，尤其帶檔案分享（canShare({files})）常直接失敗，
// 導致舊版分享一路 fallback 到「複製剪貼簿」——這是 TWA（走真正 Chrome，
// navigator.share 支援完整）換成 Capacitor 後的體驗退化，玩家看不到系統分享面板
// 跟 LINE/FB/IG 那排捷徑圖示。
//
// 修法：不透過 WebView 的 Web Share API，改用官方 @capacitor/share 直接呼叫
// Android 原生分享 Intent。圖片分享官方文件標準做法：先用 @capacitor/filesystem
// 把圖片寫進裝置暫存目錄（Directory.Cache）拿到 file:// URI，再交給 Share.share({files})
// ——Capacitor 的 Share 外掛內建會把同一個 App 沙盒內的 file:// URI 轉成
// content:// URI 過 FileProvider（跟 Android 7+ 的 FileUriExposedException 限制
// 相容），不需要額外手動設定，這是 Filesystem+Share 搭配使用的官方標準模式。
//
// ⚠️ 這裡只能在瀏覽器 preview 驗證「不會拋例外、code path 正確」，實際系統分享面板
// 彈出、LINE/FB/IG 捷徑圖示是否出現，需要真機驗證（web 環境沒有這兩個外掛的原生實作）。

import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string; // "data:image/png;base64,XXXX"
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// 圖卡 + 檔案分享。blob 為 null（renderShareCard 失敗）時退回純文字分享。
// 回傳是否成功叫出分享面板（使用者自己取消不算失敗，因為原生分享 Intent
// 對「取消」的行為因廠牌而異，這裡採寬鬆判定：能叫出面板就算成功，不強求
// 追蹤使用者最終有沒有真的選了一個 App 分享出去）。
export async function shareNative(
  blob: Blob | null,
  title: string,
  text: string,
  url: string,
): Promise<boolean> {
  if (blob) {
    try {
      const base64 = await blobToBase64(blob);
      const written = await Filesystem.writeFile({
        path: "taiexrider-score.png",
        data: base64,
        directory: Directory.Cache,
      });
      await Share.share({ title, text: `${text}\n${url}`, files: [written.uri] });
      return true;
    } catch (e) {
      // 面板已經跳出來過（無論使用者真的分享出去還是關掉/取消），不再退回純文字
      // 分享——否則會變成連續跳兩個分享面板。真正失敗（例如寫檔失敗）也視同結束。
      console.warn("[share] 原生圖卡分享結束或失敗", e);
      return false;
    }
  }
  try {
    await Share.share({ title, text, url });
    return true;
  } catch (e) {
    console.warn("[share] 原生純文字分享也失敗", e);
    return false;
  }
}
