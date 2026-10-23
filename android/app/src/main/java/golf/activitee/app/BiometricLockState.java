package golf.activitee.app;

import java.util.Objects;

/** Account-bound local screen protection, independent of server authentication. */
final class BiometricLockState {
    private String ownerID;
    private String currentUserID;
    private String pendingUserID;
    private boolean hasPendingSession;
    private boolean locked;
    private int generation;

    BiometricLockState(String ownerID) {
        this.ownerID = storedOwner(ownerID);
        currentUserID = this.ownerID;
        locked = this.ownerID != null;
    }

    static String storedOwner(Object value) {
        if (!(value instanceof String)) return null;
        String owner = ((String) value).trim();
        // Also repair the literal sentinel persisted by older versions.
        return owner.isEmpty() || "null".equals(owner) ? null : owner;
    }

    String ownerID() { return ownerID; }
    boolean enabled() { return ownerID != null; }
    boolean locked() { return locked; }
    int generation() { return generation; }
    boolean canConfigure(String userID) { return !locked && Objects.equals(currentUserID, userID); }

    void background() {
        generation++;
        if (enabled()) locked = true;
    }

    void coverForSystemAuthentication() {
        // Keep an in-flight system credential result valid, but cancellation
        // must never expose content after this Activity has been stopped.
        if (enabled()) locked = true;
    }

    void configure(String userID, boolean enabled) {
        ownerID = enabled ? userID : null;
        currentUserID = userID;
        locked = false;
        generation++;
    }

    void synchronizeUser(String userID) {
        // Session expiry or sign-out behind the cover must not reveal the WebView.
        if (locked) {
            pendingUserID = userID;
            hasPendingSession = true;
            return;
        }
        if (!Objects.equals(currentUserID, userID)) {
            currentUserID = userID;
            generation++;
        }
        if (ownerID != null && !ownerID.equals(userID)) ownerID = null;
    }

    boolean completeUnlock(boolean success, int attemptGeneration) {
        if (!success || generation != attemptGeneration || !locked) return false;
        locked = false;
        if (hasPendingSession) {
            hasPendingSession = false;
            synchronizeUser(pendingUserID);
            pendingUserID = null;
        }
        return true;
    }
}
