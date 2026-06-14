import SwiftUI
import UIKit

@main
struct TendApp: App {
    @State private var model = TendAppModel.make()

    init() {
        let normal = UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(white: 0.82, alpha: 1)
                : UIColor(white: 0.36, alpha: 1)
        }
        let selected = UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 0.52, green: 0.66, blue: 1, alpha: 1)
                : UIColor(red: 0.13, green: 0.33, blue: 0.80, alpha: 1)
        }
        let background = UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 0.115, green: 0.110, blue: 0.094, alpha: 1)
                : UIColor(red: 0.992, green: 0.988, blue: 0.972, alpha: 1)
        }
        let appearance = UITabBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = background
        for item in [
            appearance.stackedLayoutAppearance,
            appearance.inlineLayoutAppearance,
            appearance.compactInlineLayoutAppearance,
        ] {
            item.normal.iconColor = normal
            item.normal.titleTextAttributes = [.foregroundColor: normal]
            item.selected.iconColor = selected
            item.selected.titleTextAttributes = [.foregroundColor: selected]
        }
        UITabBar.appearance().standardAppearance = appearance
        UITabBar.appearance().scrollEdgeAppearance = appearance
    }

    var body: some Scene {
        WindowGroup {
            RootView(model: model)
                .task {
                    await model.start()
                }
        }
    }
}
