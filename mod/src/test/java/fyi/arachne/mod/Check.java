package fyi.arachne.mod;

/** Minimal assertions for the main-method check suites (no JUnit needed, same as v1.5.0). */
public final class Check {
    private static int passed;

    public static void eq(Object expected, Object actual, String what) {
        if (expected == null ? actual != null : !expected.equals(actual)) {
            throw new AssertionError(what + ": expected <" + expected + "> but was <" + actual + ">");
        }
        passed++;
    }

    public static void yes(boolean condition, String what) {
        if (!condition) throw new AssertionError(what);
        passed++;
    }

    public static void done(String suite) {
        System.out.println(suite + ": " + passed + " checks passed");
    }

    private Check() {}
}
