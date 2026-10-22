package golf.activitee.app;

import static org.junit.Assert.*;
import org.junit.Test;

public class BiometricLockStateTest {
    @Test public void explicitEnrollmentLocksAfterBackgroundAndColdStart() {
        BiometricLockState state = new BiometricLockState(null);
        assertFalse(state.enabled());
        state.synchronizeUser("player");
        assertTrue(state.canConfigure("player"));
        assertFalse(state.canConfigure("another-account"));
        state.configure("player", true);
        assertFalse(state.locked());
        state.background();
        assertTrue(state.locked());
        assertFalse(state.canConfigure("player"));
        assertTrue(new BiometricLockState(state.ownerID()).locked());
    }

    @Test public void cancellationAndStaleCallbacksNeverUnlock() {
        BiometricLockState state = new BiometricLockState("player");
        assertFalse(state.completeUnlock(false, state.generation()));
        int staleAttempt = state.generation();
        state.background();
        assertFalse(state.completeUnlock(true, staleAttempt));
        assertTrue(state.locked());
        assertTrue(state.completeUnlock(true, state.generation()));
        assertFalse(state.locked());
    }

    @Test public void signOutBehindCoverIsDeferredUntilAuthentication() {
        BiometricLockState state = new BiometricLockState("player");
        state.synchronizeUser(null);
        assertTrue(state.enabled());
        assertTrue(state.locked());
        assertTrue(state.completeUnlock(true, state.generation()));
        assertFalse(state.locked());
        assertFalse(state.enabled());
    }

    @Test public void accountSwitchClearsThePreviousDevicePreference() {
        BiometricLockState state = new BiometricLockState(null);
        state.synchronizeUser("parent");
        state.configure("parent", true);
        int previous = state.generation();
        state.synchronizeUser("parent");
        assertEquals(previous, state.generation());
        assertTrue(state.enabled());
        state.synchronizeUser("coach");
        assertFalse(state.enabled());
        assertNotEquals(previous, state.generation());
        assertFalse(state.canConfigure("parent"));
        assertTrue(state.canConfigure("coach"));
    }

    @Test public void cancelledSystemCredentialScreenKeepsContentCovered() {
        BiometricLockState state = new BiometricLockState(null);
        state.synchronizeUser("player");
        state.configure("player", true);
        int attempt = state.generation();
        state.coverForSystemAuthentication();
        assertTrue(state.locked());
        assertEquals(attempt, state.generation());
        assertFalse(state.completeUnlock(false, attempt));
        assertTrue(state.locked());
        assertTrue(state.completeUnlock(true, attempt));
    }

    @Test public void verifiedDisableAndSignOutRemoveThePreference() {
        BiometricLockState state = new BiometricLockState(null);
        state.configure("player", true);
        state.configure("player", false);
        state.background();
        assertFalse(state.enabled());
        assertFalse(state.locked());
        state.configure("player", true);
        state.synchronizeUser(null);
        assertFalse(state.enabled());
    }
}
