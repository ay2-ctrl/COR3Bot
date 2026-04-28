package com.cor3.bot;

import android.annotation.SuppressLint;
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
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.EditText;
import androidx.appcompat.app.AppCompatActivity;
import java.io.IOException;
import java.io.InputStream;

public class MainActivity extends AppCompatActivity {

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
        webView.setKeepScreenOn(true);
        webView.getSettings().setJavaScriptEnabled(true);
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
        s.setLoadWithOverviewMode(false);
        s.setUseWideViewPort(false);
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setUserAgentString(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
                        "AppleWebKit/537.36 (KHTML, like Gecko) " +
                        "Chrome/124.0.0.0 Safari/537.36"
        );

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
                return false; // her URL'ye izin ver
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
                                "    m.setAttribute('content', 'width=1280, user-scalable=yes');" +
                                "  } else {" +
                                "    var meta = document.createElement('meta');" +
                                "    meta.name = 'viewport';" +
                                "    meta.content = 'width=1280, user-scalable=yes';" +
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
        urlInput.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_GO ||
                    (event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER)) {
                navigateTo(urlInput.getText().toString().trim());
                return true;
            }
            return false;
        });

        ((Button) findViewById(R.id.btn_go)).setOnClickListener(v -> {
            String current = webView.getUrl();
            String input = urlInput.getText().toString().trim();

            // Eğer URL aynıysa Enter simüle et, değilse git
            if (current != null && (current.equals(input) ||
                    current.equals("https://" + input) ||
                    current.equals("http://" + input))) {
                // Aynı sayfadayız - Enter tuşu simüle et
                webView.evaluateJavascript(
                        "var el = document.activeElement;" +
                                "if (el) {" +
                                "  var e = new KeyboardEvent('keydown', {key:'Enter',keyCode:13,bubbles:true});" +
                                "  el.dispatchEvent(e);" +
                                "  var e2 = new KeyboardEvent('keyup', {key:'Enter',keyCode:13,bubbles:true});" +
                                "  el.dispatchEvent(e2);" +
                                "  if (el.form) el.form.submit();" +
                                "}",
                        null
                );
            } else {
                navigateTo(input);
            }

            // Klavyeyi kapat
            InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
            if (imm != null) imm.hideSoftInputFromWindow(urlInput.getWindowToken(), 0);
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


        ((Button) findViewById(R.id.btn_joke)).setOnClickListener(v -> {
            toggleJoke();
        });



        // PC/Loadout button - toggle loadout view
        final boolean[] pcActive = {false};
        ((Button) findViewById(R.id.btn_pc)).setOnClickListener(v -> {
            if (!pcActive[0]) {
                webView.evaluateJavascript(
                        "(function() {" +
                                "  var btn = document.querySelector('[data-component-name=\"LoadoutTabBarItem\"]');" +
                                "  if (btn) { btn.click(); console.log('[COR3Bot] Loadout clicked'); }" +
                                "  else { console.warn('[COR3Bot] Loadout button not found'); }" +
                                "})();",
                        null
                );
                pcActive[0] = true;
            } else {
                if (webView.canGoBack()) {
                    webView.goBack();
                }
                pcActive[0] = false;
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
        webView.evaluateJavascript(
                "document.body.style.zoom = '" + (zoomPercent / 100.0f) + "';",
                null
        );
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
    private boolean jokeActive = false;
    private android.view.ViewGroup jokeOverlay = null;

    private void toggleJoke() {
        if (jokeActive) {
            if (jokeOverlay != null) {
                ((android.widget.FrameLayout) getWindow().getDecorView()
                        .findViewById(android.R.id.content)).removeView(jokeOverlay);
                jokeOverlay = null;
            }
            jokeActive = false;
            ((Button) findViewById(R.id.btn_joke)).setBackgroundColor(0xFF440000);
            return;
        }

        jokeActive = true;
        ((Button) findViewById(R.id.btn_joke)).setBackgroundColor(0xFFaa0000);

        android.widget.FrameLayout root = (android.widget.FrameLayout)
                getWindow().getDecorView().findViewById(android.R.id.content);

        jokeOverlay = new android.widget.FrameLayout(this) {
            @Override
            public boolean onTouchEvent(android.view.MotionEvent event) {
                if (event.getAction() == android.view.MotionEvent.ACTION_DOWN) {
                    showWhipAt((android.widget.FrameLayout) this,
                            (int) event.getX(), (int) event.getY());
                }
                return false;
            }
        };

        android.widget.FrameLayout.LayoutParams lp =
                new android.widget.FrameLayout.LayoutParams(
                        android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                        android.widget.FrameLayout.LayoutParams.MATCH_PARENT
                );
        jokeOverlay.setBackgroundColor(0x00000000);
        jokeOverlay.setClickable(false);

        root.addView(jokeOverlay, lp);
    }
    private void showWhipAt(android.widget.FrameLayout parent, int touchX, int touchY) {
        final int FRAMES = 35;
        final int[] frame = {0};
        android.media.MediaPlayer mp = android.media.MediaPlayer.create(this, R.raw.whip);
        if (mp != null) {
            mp.start();
            mp.setOnCompletionListener(m -> m.release());
        }

        android.view.View whipView = new android.view.View(this) {
            @Override
            protected void onDraw(android.graphics.Canvas canvas) {
                android.graphics.Paint paint = new android.graphics.Paint();
                paint.setAntiAlias(true);
                paint.setStrokeCap(android.graphics.Paint.Cap.ROUND);
                paint.setStyle(android.graphics.Paint.Style.STROKE);

                float progress = (float) frame[0] / FRAMES;

                int W = getWidth();
                int H = getHeight();

                // Kol: ekranın tam altında, tıklanan X'te dikey
                float kolX      = touchX;
                float kolBottom = H - 20;
                float kolTop    = H - 180; // kol 160px uzunluk

                // KOL ÇİZ
                paint.setColor(0xFF3A1F00);
                paint.setStrokeWidth(30f);
                canvas.drawLine(kolX, kolBottom, kolX, kolBottom - 60, paint);
                paint.setColor(0xFF7B4A2F);
                paint.setStrokeWidth(22f);
                canvas.drawLine(kolX, kolBottom - 60, kolX, kolTop, paint);

                // İp başlangıç noktası: kol üstü
                float startX = kolX;
                float startY = kolTop;

                // İpin uç hedefi zamana göre:
                // 0→0.3: uç sağda (geri çekme)
                // 0.3→0.7: uç sağdan tıklanan noktaya hızla gider
                // 0.7→1.0: uç tıklanan noktada, titreşim söner
                float endX, endY;

                if (progress < 0.30f) {
                    float p = progress / 0.30f;
                    endX = startX + 200f * p;
                    endY = startY - 60f * p;
                } else if (progress < 0.70f) {
                    float p = (progress - 0.30f) / 0.40f;
                    float ease = 1f - (1f - p) * (1f - p) * (1f - p);
                    endX = (startX + 200f) + (touchX - startX - 200f) * ease;
                    endY = (startY - 60f)  + (touchY - startY + 60f)  * ease;
                } else {
                    float p = (progress - 0.70f) / 0.30f;
                    float vib = (float) Math.sin(p * Math.PI * 8) * 12f * (1f - p);
                    endX = touchX + vib;
                    endY = touchY;
                }

                // İP ÇİZ - segmentler halinde, kol ucundan uca
                int steps = 100;
                float prevX = startX, prevY = startY;
                float lastX = startX, lastY = startY;

                for (int i = 1; i <= steps; i++) {
                    float t = (float) i / steps;

                    // Dalga
                    float wave;
                    if (progress < 0.30f) {
                        float p = progress / 0.30f;
                        wave = (float) Math.sin(t * Math.PI) * 300f * p;
                    } else if (progress < 0.70f) {
                        float p = (progress - 0.30f) / 0.40f;
                        wave = (float) Math.sin(t * Math.PI * 2f)
                                * 220f * (1f - p) * (1f - t * 0.5f);
                    } else {
                        float p = (progress - 0.70f) / 0.30f;
                        wave = (float) Math.sin(t * Math.PI * 6f * (1f + p))
                                * 40f * (1f - p) * (1f - t * 0.6f);
                    }

                    float px = startX + (endX - startX) * t + wave;
                    float py = startY + (endY - startY) * t;

                    // Kalınlık: başta kalın, uca doğru incelir
                    float thickness = 8f * (1f - t * 0.75f);
                    paint.setStrokeWidth(thickness);
                    paint.setColor(0xFF888888);
                    canvas.drawLine(prevX, prevY, px, py, paint);

                    prevX = px;
                    prevY = py;
                    if (i == steps) { lastX = px; lastY = py; }
                }


                if (progress > 0.70f) {
                    float p = (progress - 0.70f) / 0.30f;
                    float fade = 1f - p;


                    paint.setStrokeWidth(4f);
                    for (int k = 0; k < 12; k++) {
                        double angle = k * Math.PI / 6;
                        float len = (40f + k * 3f) * fade;
                        paint.setColor(0xFFFF4400);
                        paint.setAlpha((int)(255 * fade));
                        canvas.drawLine(touchX, touchY,
                                touchX + (float)(Math.cos(angle) * len),
                                touchY + (float)(Math.sin(angle) * len), paint);
                    }


                    paint.setStyle(android.graphics.Paint.Style.FILL);
                    paint.setColor(0xFFFFDD00);
                    paint.setAlpha((int)(230 * fade));
                    canvas.drawCircle(touchX, touchY, 30f * fade, paint);
                    paint.setColor(0xFFFFFFFF);
                    paint.setAlpha((int)(200 * fade));
                    canvas.drawCircle(touchX, touchY, 15f * fade, paint);
                    paint.setStyle(android.graphics.Paint.Style.STROKE);
                }
            }
        };

        // View tüm ekranı kapla
        android.widget.FrameLayout.LayoutParams lp =
                new android.widget.FrameLayout.LayoutParams(
                        android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                        android.widget.FrameLayout.LayoutParams.MATCH_PARENT
                );
        parent.addView(whipView, lp);

        android.os.Handler handler = new android.os.Handler();
        Runnable[] runner = {null};
        runner[0] = new Runnable() {
            @Override
            public void run() {
                frame[0]++;
                whipView.invalidate();
                if (frame[0] < FRAMES) {
                    handler.postDelayed(runner[0], 16);
                } else {
                    whipView.animate()
                            .alpha(0f)
                            .setDuration(300)
                            .withEndAction(() -> parent.removeView(whipView))
                            .start();
                }
            }
        };
        handler.post(runner[0]);
    }
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

        // Uygulamayı açacak intent
        android.app.PendingIntent pendingIntent = android.app.PendingIntent.getActivity(
                this,
                0,
                new Intent(this, MainActivity.class)
                        .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP),
                android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_IMMUTABLE
        );

        android.app.Notification notif = new android.app.Notification.Builder(this, "cor3_bot_alerts")
                .setContentTitle(title)
                .setContentText(message)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)  // ← bildirme tıklayınca app açılır
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
