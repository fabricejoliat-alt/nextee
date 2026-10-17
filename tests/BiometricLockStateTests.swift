import Foundation

@main
struct BiometricLockStateTests {
    static func main() {
        var state = BiometricLockState(ownerID: nil)
        assert(!state.enabled && !state.locked)
        state.synchronizeUser("parent")
        state.configure(userID: "parent", enabled: true)
        assert(state.enabled && !state.locked)
        state.background()
        assert(state.locked)
        assert(!state.completeUnlock(success: false, generation: state.generation))
        assert(state.locked, "Cancellation must keep content concealed")
        let staleAttempt = state.generation
        state.background()
        assert(!state.completeUnlock(success: true, generation: staleAttempt), "An old callback cannot unlock after backgrounding")
        assert(state.completeUnlock(success: true, generation: state.generation))
        assert(!state.locked && state.enabled)

        state = BiometricLockState(ownerID: state.ownerID)
        assert(state.locked, "Cold launch must require a new verification")
        state.synchronizeUser(nil)
        assert(state.enabled && state.locked, "Sign-out or session expiry cannot dismiss the native lock")
        assert(state.completeUnlock(success: true, generation: state.generation))
        assert(!state.enabled && !state.locked, "Deferred sign-out is applied only after successful verification")

        state.configure(userID: "parent", enabled: true)
        let sameAccount = state.generation
        state.synchronizeUser("parent")
        assert(state.generation == sameAccount && state.enabled, "Token refresh must keep the device preference")
        state.synchronizeUser("coach")
        assert(!state.enabled && state.generation != sameAccount, "Account switch disables the previous account preference")
        let pendingEnrollment = state.generation
        state.synchronizeUser("manager")
        assert(state.generation != pendingEnrollment, "Account changes invalidate a pending enrollment")

        state = BiometricLockState(ownerID: "parent")
        state.synchronizeUser("coach")
        assert(state.locked && state.ownerID == "parent")
        assert(state.completeUnlock(success: true, generation: state.generation))
        assert(!state.enabled)
        state.configure(userID: "coach", enabled: true)
        state.configure(userID: "coach", enabled: false)
        state.background()
        assert(!state.enabled && !state.locked)
        print("Biometric lock: 20 lifecycle, cancellation and account-isolation assertions passed")
    }
}
