package com.tylapp.taiexrider;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 固定 WebView 文字縮放為 100%，不跟隨系統「字型大小 / 顯示大小」設定放大。
        // 這是 Capacitor（系統 WebView）跟 TWA（Chrome Custom Tabs）最大的差異來源：
        // 系統 WebView 預設會把使用者的系統字型縮放乘進預設 16px（＝1rem），整個 rem
        // 版面就等比放大一點點，首頁標題變寬後撞到右上角設定鈕。Chrome 不吃這個設定，
        // 所以 TWA 版從來沒這問題。pin 成 100 後整體縮放跟 TWA 一致。
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().getSettings().setTextZoom(100);
        }

        applyImmersive();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // 沉浸式模式下使用者從螢幕邊緣滑出系統列後，系統列會暫時顯示；重新取得焦點時再藏回去
        // （immersive sticky 行為），避免系統列一直停在畫面上。
        if (hasFocus) applyImmersive();
    }

    private void applyImmersive() {
        // 內容延伸到系統列後方（edge-to-edge）；targetSdk 36 本來就強制 edge-to-edge。
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (controller != null) {
            // 同時隱藏頂部狀態列與底部三鍵導覽列
            controller.hide(WindowInsetsCompat.Type.systemBars());
            // 使用者滑動時系統列只「短暫」出現、隨後自動收回，不會把版面往下推
            controller.setSystemBarsBehavior(
                    WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        }
    }
}
