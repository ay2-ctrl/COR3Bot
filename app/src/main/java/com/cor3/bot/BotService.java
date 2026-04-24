package com.cor3.bot;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

public class BotService extends Service {

    private static final String TAG = "COR3BotService";

    // Channel for foreground service notification (silent, always visible)
    public static final String CHANNEL_ID = "cor3_bot_channel";

    // Channel for bot event alerts (high priority, makes sound)
    public static final String ALERT_CHANNEL_ID = "cor3_bot_alerts";

    private static final int NOTIFICATION_ID = 1;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        startForeground(NOTIFICATION_ID, buildNotification());
        Log.i(TAG, "✅ BotService started");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        Log.i(TAG, "BotService destroyed");
    }

    private Notification buildNotification() {
        Intent openApp = new Intent(this, MainActivity.class);
        openApp.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 0, openApp,
                PendingIntent.FLAG_IMMUTABLE
        );

        return new Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("COR3 Bot Active 🟢")
                .setContentText("Running in background... 💪")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // Foreground service channel - silent, always visible in status bar
            NotificationChannel serviceChannel = new NotificationChannel(
                    CHANNEL_ID,
                    "COR3 Bot Service",
                    NotificationManager.IMPORTANCE_LOW
            );
            serviceChannel.setDescription("COR3 Bot background service");
            serviceChannel.setShowBadge(false);

            // Alert channel - high priority for bot events (expedition, decisions)
            NotificationChannel alertChannel = new NotificationChannel(
                    ALERT_CHANNEL_ID,
                    "COR3 Bot Alerts",
                    NotificationManager.IMPORTANCE_HIGH
            );
            alertChannel.setDescription("Bot event notifications");
            alertChannel.setShowBadge(true);
            alertChannel.enableVibration(true);

            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(serviceChannel);
                manager.createNotificationChannel(alertChannel);
            }
        }
    }
}
