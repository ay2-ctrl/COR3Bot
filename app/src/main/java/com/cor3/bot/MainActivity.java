package com.cor3.bot;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.TextView;

import java.io.IOException;
import java.io.InputStream;

public class MainActivity extends Activity {

    private static final String TAG = "COR3Bot";

    private WebView webView;
    private EditText urlInput;
    private TextView infoUrl, infoScript, infoZoom, infoStatus;
    private View infoPanel;

    private String scriptContent = null;

    private boolean scriptEnabled  = true;
    private boolean scriptInjected = false;

    private PowerManager.WakeLock wakeLock;


    private int zoomPercent = 100;

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setFlags(
                WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
                WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED
        );

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // Wake lock
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "COR3Bot:WakeLock");
        wakeLock.acquire();

        // Foreground service
        Intent serviceIntent = new Intent(this, BotService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent);
        } else {
            startService(serviceIntent);
        }

        // JS dosyasını yükle
        scriptContent = loadAsset("cor3helpers.js");
        if (scriptContent == null) {
            Log.e(TAG, "cor3helpers.js Failed to load!");
        } else {
            Log.i(TAG, "cor3helpers.js loaded (" + scriptContent.length() + " karakter)");
        }


        setContentView(R.layout.activity_main);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                    != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                requestPermissions(
                        new String[]{android.Manifest.permission.POST_NOTIFICATIONS},
                        1001
                );
            }
        }


        urlInput   = (EditText)  findViewById(R.id.url_input);
        infoPanel  = (View)      findViewById(R.id.info_panel);
        infoUrl    = (TextView)  findViewById(R.id.info_url);
        infoScript = (TextView)  findViewById(R.id.info_script);
        infoZoom   = (TextView)  findViewById(R.id.info_zoom);
        infoStatus = (TextView)  findViewById(R.id.info_status);


        webView = new WebView(this);
        FrameLayout container = (FrameLayout) findViewById(R.id.webview_container);
        container.addView(webView);


        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);



        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);


        s.setUserAgentString(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
                        "AppleWebKit/537.36 (KHTML, like Gecko) " +
                        "Chrome/124.0.0.0 Safari/537.36"
        );


        webView.setInitialScale(1);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);

        // JS Bridge
        webView.addJavascriptInterface(new JsBridge(), "AndroidBridge");


        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage msg) {
                Log.d(TAG + "/JS", "[" + msg.messageLevel() + "] " + msg.message());
                return true;
            }
        });

        // WebView client
        webView.setWebViewClient(new WebViewClient() {

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {

                String url = request.getUrl().toString();
                return !url.contains("cor3.gg");
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                scriptInjected = false;
                runOnUiThread(() -> {
                    urlInput.setText(url);
                    updateInfoPanel(url, "Loading...", false);
                    setStatus("Loading...", "#ffaa44");
                });
                Log.i(TAG, "Loading: " + url);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                runOnUiThread(() -> {
                    urlInput.setText(url);
                    setStatus("Ready", "#44ff88");
                    updateInfoPanel(url, scriptInjected ? "Active ✓" : "Expected...", scriptInjected);
                });


                view.evaluateJavascript(
                        "(function() {" +
                                "  var m = document.querySelector('meta[name=viewport]');" +
                                "  if (m) {" +
                                "    m.setAttribute('content', 'width=1280, user-scalable=yes, minimum-scale=0.1, maximum-scale=10.0');" +
                                "  } else {" +
                                "    var meta = document.createElement('meta');" +
                                "    meta.name = 'viewport';" +
                                "    meta.content = 'width=1280, user-scalable=yes, minimum-scale=0.1, maximum-scale=10.0';" +
                                "    document.head.appendChild(meta);" +
                                "  }" +
                                "})();",
                        null
                );

                if (scriptContent != null && !scriptInjected && url.contains("cor3.gg") && scriptEnabled) {
                    injectScript(view);
                }

                Log.i(TAG, "Loaded: " + url);
            }

            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                runOnUiThread(() -> setStatus("Error: " + description, "#ff4444"));
            }
        });

        // --- URL giriş - klavyede "Git" tuşu ---
        urlInput.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_GO ||
                    (event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER)) {
                navigateTo(urlInput.getText().toString().trim());
                return true;
            }
            return false;
        });


        ((Button) findViewById(R.id.btn_go)).setOnClickListener(v -> {
            navigateTo(urlInput.getText().toString().trim());
        });

        // --- Zoom Out ---
        ((Button) findViewById(R.id.btn_zoom_out)).setOnClickListener(v -> {
            if (zoomPercent > 50) {
                zoomPercent -= 10;
                applyZoom();
            }
        });

        // --- Zoom In ---
        ((Button) findViewById(R.id.btn_zoom_in)).setOnClickListener(v -> {
            if (zoomPercent < 200) {
                zoomPercent += 10;
                applyZoom();
            }
        });

        // Script toggle button
        Button btnToggle = (Button) findViewById(R.id.btn_toggle_script);
        btnToggle.setOnClickListener(v -> {
            if (scriptInjected) {
                // Disable script
                scriptEnabled = false;
                scriptInjected = false;
                webView.evaluateJavascript(
                        "window.__socketHookActive = false;" +
                                "window.__autoExpeditionEventActive = false;" +
                                "window.__autoExpeditionRestartActive = false;" +
                                "window.__jobAutomation = false;" +
                                "window.__jobTimerActive = false;",
                        null
                );
                scriptInjected = false;
                btnToggle.setBackgroundColor(android.graphics.Color.parseColor("#4a1a1a"));
                btnToggle.setTextColor(android.graphics.Color.parseColor("#ff4444"));
                setStatus("Script Disabled", "#ff4444");
                sendNotification("COR3 Bot ⛔ Script Disabled", "Bot automation stopped", 3);
            } else {
                // Enable script
                scriptEnabled = true;
                if (scriptContent != null) {
                    injectScript(webView);
                    btnToggle.setBackgroundColor(android.graphics.Color.parseColor("#1a4a1a"));
                    btnToggle.setTextColor(android.graphics.Color.parseColor("#44ff88"));
                }
            }
        });
        ((Button) findViewById(R.id.btn_info)).setOnClickListener(v -> {
            if (infoPanel.getVisibility() == View.VISIBLE) {
                infoPanel.setVisibility(View.GONE);
            } else {
                updateInfoPanel(webView.getUrl(), scriptInjected ? "Active ✓" : "DeActive", scriptInjected);
                infoPanel.setVisibility(View.VISIBLE);
            }
        });
        // Refresh button
        ((Button) findViewById(R.id.btn_refresh)).setOnClickListener(v -> {
            if (webView.getUrl() != null) {
                webView.reload();
            }
        });


    }


    private void navigateTo(String url) {
        if (url == null || url.isEmpty()) return;
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            url = "https://" + url;
        }

        InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
        if (imm != null) imm.hideSoftInputFromWindow(urlInput.getWindowToken(), 0);

        webView.loadUrl(url);
    }


    private void applyZoom() {
        webView.getSettings().setTextZoom(zoomPercent);
        if (infoZoom != null) infoZoom.setText("Zoom: %" + zoomPercent);
        Log.d(TAG, "Zoom: %" + zoomPercent);
    }


    private void updateInfoPanel(String url, String scriptState, boolean active) {
        if (infoUrl != null)    infoUrl.setText("URL: " + (url != null ? url : "-"));
        if (infoScript != null) {
            infoScript.setText("Script: " + scriptState);
            infoScript.setTextColor(active
                    ? android.graphics.Color.parseColor("#44ff88")
                    : android.graphics.Color.parseColor("#ffaa44"));
        }
        if (infoZoom != null)   infoZoom.setText("Zoom: %" + zoomPercent);
    }


    private void setStatus(String text, String hexColor) {
        if (infoStatus != null) {
            infoStatus.setText("Status: " + text);
            infoStatus.setTextColor(android.graphics.Color.parseColor(hexColor));
        }
    }


    private void injectScript(WebView view) {
        String safeScript =
                "(function() { try { " +
                        scriptContent +
                        "\n console.log('[COR3Bot] Script active!'); " +
                        "} catch(e) { console.error('[COR3Bot] Script error:', e.toString()); } })();";

        view.evaluateJavascript(safeScript, result -> {
            scriptInjected = true;
            runOnUiThread(() -> {
                updateInfoPanel(webView.getUrl(), "Active ✓", true);
                setStatus("Script Active", "#44ff88");
                sendNotification("COR3 Bot 🟢 Script Active", "Bot is running in the background 💪", 2);
            });
            Log.i(TAG, "Script injected: " + result);
        });
    }

    // Asset dosyası oku
    private String loadAsset(String filename) {
        try {
            InputStream is = getAssets().open(filename);
            byte[] buffer = new byte[is.available()];
            int totalRead = 0;
            while (totalRead < buffer.length) {
                int read = is.read(buffer, totalRead, buffer.length - totalRead);
                if (read == -1) break;
                totalRead += read;
            }
            is.close();
            return new String(buffer, 0, totalRead, "UTF-8");
        } catch (IOException e) {
            Log.e(TAG, "Asset could not be loaded.: " + filename, e);
            return null;
        }
    }


    // Normal notification - no vibration
    private void sendNotification(String title, String message, int id) {
        android.app.NotificationManager nm =
                (android.app.NotificationManager) getSystemService(NOTIFICATION_SERVICE);

        android.app.Notification notif = new android.app.Notification.Builder(this, "cor3_bot_alerts")
                .setContentTitle(title)
                .setContentText(message)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setAutoCancel(true)
                .build();

        nm.notify(id, notif);
    }

    // Decision notification - with vibration
    private void sendDecisionNotification(String title, String message) {
        android.app.NotificationManager nm =
                (android.app.NotificationManager) getSystemService(NOTIFICATION_SERVICE);

        android.app.Notification notif = new android.app.Notification.Builder(this, "cor3_bot_alerts")
                .setContentTitle(title)
                .setContentText(message)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setAutoCancel(true)
                .setVibrate(new long[]{0, 500, 200, 500})
                .setPriority(android.app.Notification.PRIORITY_HIGH)
                .build();

        nm.notify((int) System.currentTimeMillis(), notif);
    }



    // JS Bridge
    public class JsBridge {
        @JavascriptInterface
        public void notifyDecision(String title, String message) {
            runOnUiThread(() -> {
                sendDecisionNotification(title, message);
            });
        }
        @JavascriptInterface
        public void log(String message) {
            Log.i(TAG + "/Bridge", message);
        }

        @JavascriptInterface
        public void error(String message) {
            Log.e(TAG + "/Bridge", message);
        }
    }

    @Override
    public void onBackPressed() {
        if (infoPanel.getVisibility() == View.VISIBLE) {
            infoPanel.setVisibility(View.GONE);
        } else if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
        webView.resumeTimers();
    }

    @Override
    protected void onPause() {
        super.onPause();

    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        webView.destroy();
        stopService(new Intent(this, BotService.class));
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
    }
}
