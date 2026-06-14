import Foundation

actor MobileCache {
    private let snapshotURL: URL
    private let draftsURL: URL
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init(fileManager: FileManager = .default, directory: URL? = nil) {
        let directory = directory
            ?? fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("Tend", isDirectory: true)
        try? fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        snapshotURL = directory.appendingPathComponent("mobile-snapshot.json")
        draftsURL = directory.appendingPathComponent("drafts.json")
    }

    func loadSnapshot() -> MobileSnapshot? {
        guard let data = try? Data(contentsOf: snapshotURL) else { return nil }
        return try? decoder.decode(MobileSnapshot.self, from: data)
    }

    func save(snapshot: MobileSnapshot) {
        guard let data = try? encoder.encode(snapshot) else { return }
        try? data.write(to: snapshotURL, options: [.atomic, .completeFileProtection])
    }

    func loadDrafts() -> [String: String] {
        guard let data = try? Data(contentsOf: draftsURL) else { return [:] }
        return (try? decoder.decode([String: String].self, from: data)) ?? [:]
    }

    func save(drafts: [String: String]) {
        guard let data = try? encoder.encode(drafts) else { return }
        try? data.write(to: draftsURL, options: [.atomic, .completeFileProtection])
    }

    func clear() {
        try? FileManager.default.removeItem(at: snapshotURL)
        try? FileManager.default.removeItem(at: draftsURL)
    }
}

enum DeviceIdentity {
    private static let key = "tend.mobile.device-id"

    static func value(defaults: UserDefaults = .standard) -> String {
        if let existing = defaults.string(forKey: key) {
            return existing
        }
        let created = UUID().uuidString.lowercased()
        defaults.set(created, forKey: key)
        return created
    }
}
