import SwiftUI

struct MindView: View {
    @Bindable var model: TendAppModel
    @State private var safariDestination: SafariDestination?
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        NavigationStack {
            ZStack {
                TendTheme.paper.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 22) {
                        if dynamicTypeSize.isAccessibilitySize {
                            VStack(alignment: .leading, spacing: 10) {
                                TendWordmark(subtitle: "A filtered view of what is occupying your attention")
                                MindHealthBadge(health: model.snapshot.mind.health)
                            }
                        } else {
                            HStack(alignment: .top) {
                                TendWordmark(subtitle: "A filtered view of what is occupying your attention")
                                Spacer()
                                MindHealthBadge(health: model.snapshot.mind.health)
                                    .padding(.top, 8)
                            }
                        }

                        if let update = model.snapshot.mind.current {
                            currentMind(update)
                        } else {
                            ContentUnavailableView(
                                "Nothing published yet",
                                systemImage: "sparkles",
                                description: Text("Chronicle Pulse will publish a privacy-filtered synthesis when there is a useful new signal.")
                            )
                            .padding(.vertical, 70)
                        }

                        if !model.snapshot.mind.history.isEmpty {
                            history
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                    .padding(.bottom, 28)
                }
                .refreshable {
                    await model.refresh()
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await model.refresh() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .accessibilityLabel("Refresh On Your Mind")
                }
            }
            .toolbarBackground(TendTheme.paper, for: .navigationBar)
            .sheet(item: $safariDestination) { destination in
                SafariSheet(url: destination.url)
                    .ignoresSafeArea()
            }
        }
    }

    private func currentMind(_ update: MobileMindUpdate) -> some View {
        VStack(alignment: .leading, spacing: 22) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Label("CURRENT SYNTHESIS", systemImage: "sparkles")
                        .font(.caption.weight(.bold))
                        .tracking(0.9)
                        .foregroundStyle(TendTheme.cobalt)
                    Spacer()
                    Text(update.publishedAt.tendDate?.tendRelative ?? "")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Text(update.summary)
                    .font(.system(.title2, design: .serif, weight: .medium))
                    .foregroundStyle(TendTheme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Label(observationWindow(update), systemImage: "eye")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(20)
            .tendCardSurface()

            sectionTitle("Signals", detail: "\(update.signals.count)")
            ForEach(update.signals) { signal in
                MindSignalCard(
                    signal: signal,
                    observations: update.observations.filter { signal.observationIds.contains($0.id) },
                    openURL: openURL
                )
            }

            sectionTitle("Source trail", detail: "\(update.observations.count)")
            VStack(spacing: 12) {
                ForEach(update.observations) { observation in
                    MindSourceCard(observation: observation, openURL: openURL)
                }
            }
        }
    }

    private var history: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle("Recent pulses", detail: "\(model.snapshot.mind.history.count)")
            ForEach(model.snapshot.mind.history) { item in
                HStack(alignment: .top, spacing: 12) {
                    Circle()
                        .fill(item.state == "fresh" ? TendTheme.sage : TendTheme.hairline)
                        .frame(width: 9, height: 9)
                        .padding(.top, 6)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(item.summary ?? item.reason ?? "Pulse recorded")
                            .font(.subheadline.weight(.medium))
                        Text("\(item.signalCount) signals · \(item.sourceCount) sources · \(item.publishedAt.tendDate?.tendRelative ?? "")")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 4)
            }
        }
    }

    private func sectionTitle(_ title: String, detail: String) -> some View {
        HStack {
            Text(title)
                .font(.title3.weight(.semibold))
            Spacer()
            Text(detail)
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
        }
    }

    private func observationWindow(_ update: MobileMindUpdate) -> String {
        guard let start = update.observedFrom.tendDate, let end = update.observedTo.tendDate else {
            return "Privacy-filtered Chronicle window"
        }
        return "Observed \(start.formatted(date: .omitted, time: .shortened))–\(end.formatted(date: .omitted, time: .shortened))"
    }

    private func openURL(_ value: String) {
        guard let url = URL(string: value),
              ["http", "https"].contains(url.scheme?.lowercased() ?? "") else { return }
        safariDestination = SafariDestination(url: url)
    }
}

private struct MindHealthBadge: View {
    let health: String

    var body: some View {
        StateBadge(
            text: health == "fresh" ? "Fresh" : health.titleCasedIdentifier,
            tone: health == "fresh" ? TendTheme.sage : TendTheme.amber
        )
    }
}

private struct MindSignalCard: View {
    let signal: MobileMindSignal
    let observations: [MobileMindObservation]
    let openURL: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack {
                Label(signal.kind.titleCasedIdentifier.uppercased(), systemImage: icon)
                    .font(.caption.weight(.bold))
                    .tracking(0.8)
                    .foregroundStyle(tone)
                Spacer()
                Text("\(observations.count) \(observations.count == 1 ? "source" : "sources")")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Text(signal.title)
                .font(.system(.title3, design: .serif, weight: .semibold))
            Text(signal.summary)
                .foregroundStyle(TendTheme.secondaryInk)
                .fixedSize(horizontal: false, vertical: true)
            if !observations.isEmpty {
                Divider()
                ForEach(observations) { observation in
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "doc.text")
                            .foregroundStyle(.secondary)
                            .padding(.top, 2)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(observation.title)
                                .font(.subheadline.weight(.semibold))
                            Text(observation.excerpt)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                        }
                        Spacer(minLength: 0)
                        if let href = observation.href {
                            Button {
                                openURL(href)
                            } label: {
                                Image(systemName: "arrow.up.right.square")
                            }
                            .accessibilityLabel("Open \(observation.title)")
                        }
                    }
                }
            }
        }
        .padding(18)
        .tendCardSurface()
    }

    private var tone: Color {
        switch signal.kind {
        case "changed_now": TendTheme.cobalt
        case "unresolved": TendTheme.amber
        default: TendTheme.sage
        }
    }

    private var icon: String {
        switch signal.kind {
        case "changed_now": "bolt.fill"
        case "unresolved": "questionmark.circle.fill"
        default: "arrow.triangle.2.circlepath"
        }
    }
}

private struct MindSourceCard: View {
    let observation: MobileMindObservation
    let openURL: (String) -> Void
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(observation.title)
                        .font(.headline)
                    Text(sourceLine)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if let href = observation.href {
                    Button {
                        openURL(href)
                    } label: {
                        Image(systemName: "arrow.up.right.square")
                    }
                    .accessibilityLabel("Open source")
                }
            }
            Text(observation.excerpt)
                .foregroundStyle(TendTheme.secondaryInk)
                .fixedSize(horizontal: false, vertical: true)

            if let fullText = observation.fullText, !fullText.isEmpty {
                DisclosureGroup(isExpanded: $expanded) {
                    Text(fullText)
                        .font(.subheadline)
                        .foregroundStyle(TendTheme.secondaryInk)
                        .textSelection(.enabled)
                        .padding(.top, 8)
                } label: {
                    Text(expanded ? "Hide filtered window" : "Show full filtered window")
                        .font(.subheadline.weight(.semibold))
                }
                .accessibilityIdentifier("mind-source-\(observation.id)-expand")
                .accessibilityLabel(expanded ? "Hide filtered window" : "Show full filtered window")
            }

            if let redactions = observation.redactionCount, redactions > 0 {
                Label("\(redactions) private \(redactions == 1 ? "detail" : "details") removed", systemImage: "hand.raised.fill")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(17)
        .background(TendTheme.paperRaised)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(TendTheme.hairline.opacity(0.75))
        }
    }

    private var sourceLine: String {
        [observation.app, observation.artifact, observation.observedTo.tendDate?.tendRelative]
            .compactMap { $0 }
            .joined(separator: " · ")
    }
}
