import Foundation

protocol TendRepository: Sendable {
    var usesFixtures: Bool { get }

    func hasSession() async -> Bool
    func requestEmailCode(email: String) async throws
    func verifyEmailCode(email: String, code: String) async throws
    func signOut() async throws
    func loadSnapshot() async throws -> MobileSnapshot
    func submit(_ command: MobileCommandSubmission) async throws -> MobileActivity
    func cancel(commandID: UUID) async throws -> MobileActivity?
    func startObserving(_ onChange: @escaping @Sendable () async -> Void) async throws
    func stopObserving() async
}

enum TendRepositoryError: LocalizedError {
    case invalidConfiguration
    case missingResult
    case signInFailed

    var errorDescription: String? {
        switch self {
        case .invalidConfiguration: "Tend's Supabase configuration is missing."
        case .missingResult: "Tend did not receive the expected cloud result."
        case .signInFailed: "The email code could not be verified."
        }
    }
}
