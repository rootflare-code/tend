import Foundation

struct TendConfiguration: Sendable {
    let supabaseURL: URL?
    let publishableKey: String
    let allowedEmail: String
    let usesFixtures: Bool

    static func load(
        bundle: Bundle = .main,
        processInfo: ProcessInfo = .processInfo
    ) -> TendConfiguration {
        let environment = processInfo.environment
        let arguments = processInfo.arguments
        let rawURL = environment["TEND_SUPABASE_URL"]
            ?? bundle.object(forInfoDictionaryKey: "TEND_SUPABASE_URL") as? String
            ?? ""
        let key = environment["TEND_SUPABASE_PUBLISHABLE_KEY"]
            ?? bundle.object(forInfoDictionaryKey: "TEND_SUPABASE_PUBLISHABLE_KEY") as? String
            ?? ""
        let allowedEmail = environment["TEND_ALLOWED_EMAIL"]
            ?? bundle.object(forInfoDictionaryKey: "TEND_ALLOWED_EMAIL") as? String
            ?? "dan@every.to"
        let explicitFixtures = environment["TEND_USE_FIXTURES"] == "1"
            || arguments.contains("-ui-testing")
            || arguments.contains("-fixtures")
        let url = URL(string: rawURL.trimmingCharacters(in: .whitespacesAndNewlines))
        return TendConfiguration(
            supabaseURL: url,
            publishableKey: key.trimmingCharacters(in: .whitespacesAndNewlines),
            allowedEmail: allowedEmail,
            usesFixtures: explicitFixtures || url == nil || key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        )
    }
}
