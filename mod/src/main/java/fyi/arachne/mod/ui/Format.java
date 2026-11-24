package fyi.arachne.mod.ui;

import java.util.Locale;

/** Number formats shared by the HUD and chat. Same rules as the dashboard's format.ts. */
public final class Format {
    public static String coins(double value) {
        double abs = Math.abs(value);
        String sign = value < 0 ? "-" : "";
        if (abs >= 1e9) return sign + String.format(Locale.ROOT, "%.2fB", abs / 1e9);
        if (abs >= 1e6) return sign + String.format(Locale.ROOT, "%.2fM", abs / 1e6);
        if (abs >= 1e4) return sign + String.format(Locale.ROOT, "%.1fk", abs / 1e3);
        return sign + String.format(Locale.ROOT, "%,d", Math.round(abs));
    }

    public static String count(long value) {
        return String.format(Locale.ROOT, "%,d", value);
    }

    /** 3 725 000 ms → "1h 02m"; under an hour shows minutes and seconds. */
    public static String duration(long ms) {
        long s = Math.max(0, ms / 1000);
        if (s < 60) return s + "s";
        long m = s / 60;
        if (m < 60) return String.format(Locale.ROOT, "%dm %02ds", m, s % 60);
        return String.format(Locale.ROOT, "%dh %02dm", m / 60, m % 60);
    }

    public static String ago(long ms) {
        long s = Math.max(0, ms / 1000);
        if (s < 5) return "just now";
        if (s < 60) return s + "s ago";
        if (s < 3600) return s / 60 + "m ago";
        return s / 3600 + "h ago";
    }

    private Format() {}
}
