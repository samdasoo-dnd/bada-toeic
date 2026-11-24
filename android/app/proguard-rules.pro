# WebView 앱이라 별도 난독화 규칙이 없습니다.
-keepclassmembers class com.donsik.badatoeic.MainActivity$SaveBridge {
    @android.webkit.JavascriptInterface <methods>;
}
