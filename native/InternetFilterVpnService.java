package PACKAGE_NAME;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.content.Intent;
import android.net.VpnService;
import android.os.Build;
import android.os.ParcelFileDescriptor;

import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.util.Arrays;

public class InternetFilterVpnService extends VpnService {
    public static final String ACTION_START = "PACKAGE_NAME.FILTER_START";
    public static final String ACTION_STOP = "PACKAGE_NAME.FILTER_STOP";
    private static final String PREFS = "lockedin_internet_filter";
    private static final String CHANNEL_ID = "lockedin_internet_filter";
    private static final int NOTIFICATION_ID = 8217;
    private static final String DNS_UPSTREAM = "1.1.1.3"; // Cloudflare Family DNS: adult-content and malware filtering.

    private ParcelFileDescriptor vpnInterface;
    private volatile boolean running;
    private Thread worker;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_START : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopFilter();
            stopSelf();
            return START_NOT_STICKY;
        }
        createNotificationChannel();
        startForeground(NOTIFICATION_ID, buildNotification());
        if (!running) startFilter();
        return START_STICKY;
    }

    private void startFilter() {
        try {
            Builder builder = new Builder()
                    .setSession("Locked In Internet Filter")
                    .setMtu(1500)
                    .addAddress("10.111.0.1", 32)
                    .addDnsServer("10.111.0.2")
                    .addRoute("10.111.0.2", 32);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) builder.setBlocking(true);
            vpnInterface = builder.establish();
            if (vpnInterface == null) throw new IllegalStateException("Android did not establish the DNS filter connection.");
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean("enabled", true).apply();
            running = true;
            worker = new Thread(this::runPacketLoop, "LockedIn-DNS-Filter");
            worker.start();
        } catch (Exception error) {
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean("enabled", false).apply();
            stopSelf();
        }
    }

    private void runPacketLoop() {
        byte[] buffer = new byte[32767];
        try (FileInputStream input = new FileInputStream(vpnInterface.getFileDescriptor());
             FileOutputStream output = new FileOutputStream(vpnInterface.getFileDescriptor())) {
            while (running) {
                int length = input.read(buffer);
                if (length <= 0) continue;
                byte[] packet = Arrays.copyOf(buffer, length);
                byte[] dnsQuery = extractDnsQuery(packet);
                if (dnsQuery == null) continue;
                byte[] dnsResponse = forwardToFamilyDns(dnsQuery);
                if (dnsResponse == null) continue;
                byte[] responsePacket = buildIpv4UdpResponse(packet, dnsResponse);
                if (responsePacket != null) output.write(responsePacket);
            }
        } catch (Exception ignored) {
            // Closing the VPN descriptor ends the loop during normal shutdown.
        }
    }

    private byte[] extractDnsQuery(byte[] packet) {
        if (packet.length < 28 || (packet[0] >> 4 & 0x0F) != 4 || (packet[9] & 0xFF) != 17) return null;
        int headerLength = (packet[0] & 0x0F) * 4;
        if (headerLength < 20 || packet.length < headerLength + 8) return null;
        int destinationPort = u16(packet, headerLength + 2);
        if (destinationPort != 53) return null;
        int udpLength = u16(packet, headerLength + 4);
        if (udpLength < 20 || packet.length < headerLength + udpLength) return null;
        int dnsLength = udpLength - 8;
        return Arrays.copyOfRange(packet, headerLength + 8, headerLength + 8 + dnsLength);
    }

    private byte[] forwardToFamilyDns(byte[] query) {
        try (DatagramSocket socket = new DatagramSocket()) {
            if (!protect(socket)) return null;
            socket.setSoTimeout(3500);
            byte[] upstream = Arrays.copyOf(query, query.length);
            DatagramPacket request = new DatagramPacket(upstream, upstream.length, InetAddress.getByName(DNS_UPSTREAM), 53);
            socket.send(request);
            byte[] response = new byte[4096];
            DatagramPacket reply = new DatagramPacket(response, response.length);
            socket.receive(reply);
            return Arrays.copyOf(reply.getData(), reply.getLength());
        } catch (Exception error) {
            return null;
        }
    }

    private byte[] buildIpv4UdpResponse(byte[] request, byte[] dns) {
        int ipHeaderLength = (request[0] & 0x0F) * 4;
        if (request.length < ipHeaderLength + 8) return null;
        int sourcePort = u16(request, ipHeaderLength);
        byte[] response = new byte[20 + 8 + dns.length];
        response[0] = 0x45;
        response[1] = 0;
        put16(response, 2, response.length);
        response[4] = request[4]; response[5] = request[5];
        response[6] = 0x40; response[7] = 0;
        response[8] = 64; response[9] = 17;
        // Reply source is the DNS address assigned to the virtual interface.
        response[12] = 10; response[13] = 111; response[14] = 0; response[15] = 2;
        System.arraycopy(request, 12, response, 16, 4);
        put16(response, 10, checksum(response, 0, 20));
        put16(response, 20, 53);
        put16(response, 22, sourcePort);
        put16(response, 24, 8 + dns.length);
        put16(response, 26, 0); // UDP checksum is optional for IPv4.
        System.arraycopy(dns, 0, response, 28, dns.length);
        return response;
    }

    private int u16(byte[] data, int offset) { return ((data[offset] & 0xFF) << 8) | (data[offset + 1] & 0xFF); }
    private void put16(byte[] data, int offset, int value) { data[offset] = (byte) (value >>> 8); data[offset + 1] = (byte) value; }
    private int checksum(byte[] data, int offset, int length) {
        long sum = 0;
        for (int i = offset; i < offset + length; i += 2) {
            int word = (data[i] & 0xFF) << 8;
            if (i + 1 < offset + length) word |= data[i + 1] & 0xFF;
            sum += word;
        }
        while ((sum >>> 16) != 0) sum = (sum & 0xFFFF) + (sum >>> 16);
        return (int) (~sum) & 0xFFFF;
    }

    private Notification buildNotification() {
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pending = launch == null ? null : PendingIntent.getActivity(this, 8217, launch,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0));
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL_ID) : new Notification.Builder(this);
        int appIcon = getApplicationInfo().icon;
        int smallIcon = getResources().getIdentifier("ic_stat_locked_in", "drawable", getPackageName());
        if (smallIcon == 0) smallIcon = appIcon;
        builder.setContentTitle("Locked In")
                .setContentText("Internet Filter is active")
                .setSmallIcon(smallIcon)
                .setOngoing(true);
        if (appIcon != 0) {
            Bitmap largeIcon = BitmapFactory.decodeResource(getResources(), appIcon);
            if (largeIcon != null) builder.setLargeIcon(largeIcon);
        }
        if (pending != null) builder.setContentIntent(pending);
        return builder.build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Internet Filter", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Shows when Locked In DNS filtering is active.");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }

    private void stopFilter() {
        running = false;
        if (vpnInterface != null) {
            try { vpnInterface.close(); } catch (Exception ignored) { }
            vpnInterface = null;
        }
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean("enabled", false).apply();
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE);
        else stopForeground(true);
    }

    @Override public void onRevoke() { stopFilter(); stopSelf(); }
    @Override public void onDestroy() { stopFilter(); super.onDestroy(); }
}
