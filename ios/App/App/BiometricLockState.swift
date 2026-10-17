import Foundation

/// Local UI protection only. Server authentication, roles and MFA remain independent.
struct BiometricLockState {
    private(set) var ownerID: String?
    private(set) var locked: Bool
    private(set) var generation = 0
    private var pendingUserID: String?
    private var hasPendingSession = false
    private var currentUserID: String?

    init(ownerID: String?) {
        self.ownerID = ownerID
        currentUserID = ownerID
        locked = ownerID != nil
    }

    var enabled: Bool { ownerID != nil }

    mutating func background() {
        generation += 1
        if enabled { locked = true }
    }

    mutating func configure(userID: String, enabled: Bool) {
        ownerID = enabled ? userID : nil
        currentUserID = userID
        locked = false
        generation += 1
    }

    mutating func synchronizeUser(_ userID: String?) {
        // An expired session or a sign-out must never dismiss the native lock.
        if locked {
            pendingUserID = userID
            hasPendingSession = true
            return
        }
        if currentUserID != userID {
            currentUserID = userID
            generation += 1
        }
        if ownerID != nil && ownerID != userID { ownerID = nil }
    }

    mutating func completeUnlock(success: Bool, generation attempt: Int) -> Bool {
        guard success, attempt == generation, locked else { return false }
        locked = false
        if hasPendingSession {
            hasPendingSession = false
            synchronizeUser(pendingUserID)
            pendingUserID = nil
        }
        return true
    }
}
