//
//  PocketPalShortcuts.swift
//  PocketPal
//
//  App Shortcuts provider for LLMm
//

import Foundation
import AppIntents

@available(iOS 16.0, *)
struct PocketPalShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AskPalIntent(),
            phrases: [
                "Ask \(.applicationName)",
                "Ask my \(.applicationName) agent",
                "Question for \(.applicationName)",
            ],
            shortTitle: "Ask Agent",
            systemImageName: "message.fill"
        )
        
        AppShortcut(
            intent: OpenPalChatIntent(),
            phrases: [
                "Open \(.applicationName) chat",
                "Chat with my agent in \(.applicationName)",
                "Start \(.applicationName) conversation",
            ],
            shortTitle: "Open Chat",
            systemImageName: "bubble.left.and.bubble.right.fill"
        )
    }
}
