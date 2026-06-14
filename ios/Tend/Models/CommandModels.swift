import Foundation

struct MobileCommandSubmission: Encodable, Sendable {
    let id: UUID
    let clientRequestId: UUID
    let deviceId: String
    let feedId: String
    let cardId: String
    let feedGeneration: String
    let expectedCardDigest: String
    let kind: String
    let actionId: String?
    let expectedActionDigest: String?
    let routineActionGroupId: String?
    let instruction: String?
    let edits: [String: String]?
    let targetWorkId: String?
    let expectedWorkDigest: String?
    let riskConfirmation: RiskConfirmationSubmission?
}

struct RiskConfirmationSubmission: Codable, Hashable, Sendable {
    let kind: String
    let recipients: [String]
}

struct SubmitMobileCommandParameters: Encodable, Sendable {
    let command: MobileCommandSubmission

    enum CodingKeys: String, CodingKey {
        case command = "p_command"
    }
}

struct CancelMobileCommandParameters: Encodable, Sendable {
    let commandId: UUID

    enum CodingKeys: String, CodingKey {
        case commandId = "p_command_id"
    }
}

struct MobileActivity: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let feedId: String
    let cardId: String
    let kind: String
    let payload: MobileActivityPayload
    var state: String
    let availableAt: String
    let resultWorkId: String?
    let workStatus: String?
    let response: String?
    let error: String?
    let createdAt: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case feedId = "feed_id"
        case cardId = "card_id"
        case kind
        case payload
        case state
        case availableAt = "available_at"
        case resultWorkId = "result_work_id"
        case workStatus = "work_status"
        case response
        case error
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    var displayState: String {
        if state == "pending" { return "Waiting for Mac" }
        if state == "claimed" { return "Syncing" }
        if state == "rejected" { return "Needs review" }
        if state == "cancelled" { return "Undone" }
        switch workStatus {
        case "queued": return "Queued for Codex"
        case "working": return "Working"
        case "completed": return "Done"
        case "approved_blocked": return "Waiting"
        case "failed", "stale": return "Needs review"
        default: return state == "applied" ? "Recorded" : state.capitalized
        }
    }
}

struct MobileActivityPayload: Codable, Hashable, Sendable {
    let actionId: String?
    let instruction: String?
    let riskConfirmation: RiskConfirmationSubmission?
}

struct MobileFeedRow: Decodable, Sendable {
    let payload: MobileFeed
}

struct MobileCardRow: Decodable, Sendable {
    let payload: MobileCard
}

struct MobileMindRow: Decodable, Sendable {
    let payload: MobileMind
}
