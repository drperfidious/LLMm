//
//  AppleClockModule.swift
//  PocketPal
//
//  AlarmKit bridge for LLMm app-owned alarms and timers.
//

import Foundation
import React

#if canImport(AlarmKit)
import AlarmKit
import SwiftUI
#endif

@objc(AppleClockModule)
class AppleClockModule: NSObject, RCTBridgeModule {
    @objc
    static func moduleName() -> String! {
        return "AppleClockModule"
    }

    @objc
    static func requiresMainQueueSetup() -> Bool {
        return false
    }

    @objc
    func getAuthorizationStatus(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) {
            resolve(["available": true, "status": authorizationString(AlarmManager.shared.authorizationState)])
            return
        }
        #endif
        resolve(["available": false, "status": "unsupported"])
    }

    @objc
    func requestAuthorization(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) {
            Task {
                do {
                    let status = try await AlarmManager.shared.requestAuthorization()
                    resolve(["available": true, "status": self.authorizationString(status), "granted": status == .authorized])
                } catch {
                    reject("clock_authorization_error", error.localizedDescription, error)
                }
            }
            return
        }
        #endif
        reject("clock_unsupported", "AlarmKit requires iOS 26 or newer.", nil)
    }

    @objc
    func list(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) {
            do {
                let alarms = try AlarmManager.shared.alarms.map(serializeAlarm)
                resolve(alarms)
            } catch {
                reject("clock_list_failed", error.localizedDescription, error)
            }
            return
        }
        #endif
        reject("clock_unsupported", "AlarmKit requires iOS 26 or newer.", nil)
    }

    @objc
    func createTimer(_ args: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) {
            let duration = doubleValue(args["durationSeconds"]) ?? doubleValue(args["duration_seconds"]) ?? 0
            guard duration >= 1 else {
                reject("clock_invalid_duration", "durationSeconds must be at least 1.", nil)
                return
            }

            let title = stringValue(args["title"]) ?? "LLMm timer"
            Task {
                do {
                    let alarm = try await self.scheduleTimer(title: title, duration: duration)
                    self.saveLabel(title, for: alarm.id, kind: "timer")
                    resolve(self.serializeAlarm(alarm))
                } catch {
                    reject("clock_timer_failed", error.localizedDescription, error)
                }
            }
            return
        }
        #endif
        reject("clock_unsupported", "AlarmKit requires iOS 26 or newer.", nil)
    }

    @objc
    func createAlarm(_ args: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) {
            guard let rawFireDate = stringValue(args["fireDate"]) ?? stringValue(args["fire_date"]),
                  let fireDate = parseDate(rawFireDate) else {
                reject("clock_invalid_fire_date", "fireDate must be an ISO date string.", nil)
                return
            }
            guard fireDate > Date() else {
                reject("clock_past_fire_date", "fireDate must be in the future.", nil)
                return
            }

            let title = stringValue(args["title"]) ?? "LLMm alarm"
            Task {
                do {
                    let alarm = try await self.scheduleAlarm(title: title, fireDate: fireDate)
                    self.saveLabel(title, for: alarm.id, kind: "alarm")
                    resolve(self.serializeAlarm(alarm))
                } catch {
                    reject("clock_alarm_failed", error.localizedDescription, error)
                }
            }
            return
        }
        #endif
        reject("clock_unsupported", "AlarmKit requires iOS 26 or newer.", nil)
    }

    @objc
    func cancel(_ identifier: NSString, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) {
            guard let id = UUID(uuidString: identifier as String) else {
                reject("clock_invalid_id", "identifier must be an AlarmKit UUID.", nil)
                return
            }
            do {
                try AlarmManager.shared.cancel(id: id)
                removeLabel(for: id)
                resolve(["identifier": id.uuidString, "cancelled": true])
            } catch {
                reject("clock_cancel_failed", error.localizedDescription, error)
            }
            return
        }
        #endif
        reject("clock_unsupported", "AlarmKit requires iOS 26 or newer.", nil)
    }

    @objc
    func stop(_ identifier: NSString, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) {
            guard let id = UUID(uuidString: identifier as String) else {
                reject("clock_invalid_id", "identifier must be an AlarmKit UUID.", nil)
                return
            }
            do {
                try AlarmManager.shared.stop(id: id)
                resolve(["identifier": id.uuidString, "stopped": true])
            } catch {
                reject("clock_stop_failed", error.localizedDescription, error)
            }
            return
        }
        #endif
        reject("clock_unsupported", "AlarmKit requires iOS 26 or newer.", nil)
    }

    private func parseDate(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: value) {
            return date
        }
        return ISO8601DateFormatter().date(from: value)
    }

    private func isoString(_ date: Date?) -> String {
        guard let date = date else { return "" }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: date)
    }

    private func stringValue(_ value: Any?) -> String? {
        guard let value = value as? String else {
            return nil
        }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private func doubleValue(_ value: Any?) -> Double? {
        if let value = value as? Double {
            return value
        }
        if let value = value as? NSNumber {
            return value.doubleValue
        }
        if let value = value as? String {
            return Double(value)
        }
        return nil
    }

    private let labelPrefix = "llmm.alarmkit.labels."

    private func saveLabel(_ title: String, for id: UUID, kind: String) {
        let payload: [String: String] = ["title": title, "kind": kind]
        UserDefaults.standard.set(payload, forKey: labelPrefix + id.uuidString)
    }

    private func removeLabel(for id: UUID) {
        UserDefaults.standard.removeObject(forKey: labelPrefix + id.uuidString)
    }

    private func storedLabel(for id: UUID) -> [String: String] {
        return UserDefaults.standard.dictionary(forKey: labelPrefix + id.uuidString) as? [String: String] ?? [:]
    }

    #if canImport(AlarmKit)
    @available(iOS 26.0, *)
    private struct LLMmAlarmMetadata: AlarmMetadata {
        let title: String
    }

    @available(iOS 26.0, *)
    private func resource(_ value: String) -> LocalizedStringResource {
        return LocalizedStringResource(String.LocalizationValue(value))
    }

    @available(iOS 26.0, *)
    private func presentation(title: String) -> AlarmPresentation {
        let stop = AlarmButton(text: resource("Stop"), textColor: .white, systemImageName: "stop.fill")
        return AlarmPresentation(
            alert: AlarmPresentation.Alert(title: resource(title), stopButton: stop),
            countdown: AlarmPresentation.Countdown(title: resource(title)),
            paused: AlarmPresentation.Paused(
                title: resource("\(title) paused"),
                resumeButton: AlarmButton(text: resource("Resume"), textColor: .white, systemImageName: "play.fill")
            )
        )
    }

    @available(iOS 26.0, *)
    private func attributes(title: String) -> AlarmAttributes<LLMmAlarmMetadata> {
        return AlarmAttributes(
            presentation: presentation(title: title),
            metadata: LLMmAlarmMetadata(title: title),
            tintColor: Color(red: 0.49, green: 0.66, blue: 1.0)
        )
    }

    @available(iOS 26.0, *)
    private func scheduleTimer(title: String, duration: TimeInterval) async throws -> Alarm {
        let configuration = AlarmManager.AlarmConfiguration<LLMmAlarmMetadata>.timer(
            duration: duration,
            attributes: attributes(title: title)
        )
        return try await AlarmManager.shared.schedule(id: UUID(), configuration: configuration)
    }

    @available(iOS 26.0, *)
    private func scheduleAlarm(title: String, fireDate: Date) async throws -> Alarm {
        let configuration = AlarmManager.AlarmConfiguration<LLMmAlarmMetadata>.alarm(
            schedule: .fixed(fireDate),
            attributes: attributes(title: title)
        )
        return try await AlarmManager.shared.schedule(id: UUID(), configuration: configuration)
    }

    @available(iOS 26.0, *)
    private func authorizationString(_ state: AlarmManager.AuthorizationState) -> String {
        switch state {
        case .notDetermined:
            return "notDetermined"
        case .denied:
            return "denied"
        case .authorized:
            return "authorized"
        @unknown default:
            return "unknown"
        }
    }

    @available(iOS 26.0, *)
    private func stateString(_ state: Alarm.State) -> String {
        switch state {
        case .scheduled:
            return "scheduled"
        case .countdown:
            return "countdown"
        case .paused:
            return "paused"
        case .alerting:
            return "alerting"
        @unknown default:
            return "unknown"
        }
    }

    @available(iOS 26.0, *)
    private func serializeAlarm(_ alarm: Alarm) -> [String: Any] {
        let label = storedLabel(for: alarm.id)
        var result: [String: Any] = [
            "identifier": alarm.id.uuidString,
            "title": label["title"] ?? "",
            "kind": label["kind"] ?? (alarm.countdownDuration == nil ? "alarm" : "timer"),
            "state": stateString(alarm.state),
        ]

        if let schedule = alarm.schedule {
            switch schedule {
            case .fixed(let date):
                result["fireDate"] = isoString(date)
            case .relative(let relative):
                result["hour"] = relative.time.hour
                result["minute"] = relative.time.minute
                result["repeats"] = "\(relative.repeats)"
            @unknown default:
                result["schedule"] = "unknown"
            }
        }

        if let countdown = alarm.countdownDuration {
            if let preAlert = countdown.preAlert {
                result["durationSeconds"] = preAlert
            }
            if let postAlert = countdown.postAlert {
                result["postAlertSeconds"] = postAlert
            }
        }
        return result
    }
    #endif
}
