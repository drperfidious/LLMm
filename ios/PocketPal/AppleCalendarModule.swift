//
//  AppleCalendarModule.swift
//  PocketPal
//
//  EventKit bridge for LLMm Calendar and Reminders talents.
//

import EventKit
import Foundation
import React

@objc(AppleCalendarModule)
class AppleCalendarModule: NSObject, RCTBridgeModule {
    private let eventStore = EKEventStore()

    @objc
    static func moduleName() -> String! {
        return "AppleCalendarModule"
    }

    @objc
    static func requiresMainQueueSetup() -> Bool {
        return false
    }

    @objc
    func getAuthorizationStatus(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve([
            "calendar": statusString(EKEventStore.authorizationStatus(for: .event)),
            "reminders": statusString(EKEventStore.authorizationStatus(for: .reminder)),
        ])
    }

    @objc
    func requestCalendarAccess(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        requestEventsAccess { granted, status, error in
            if let error = error {
                reject("calendar_access_error", error.localizedDescription, error)
                return
            }
            resolve(["granted": granted, "status": self.statusString(status)])
        }
    }

    @objc
    func requestReminderAccess(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        requestRemindersAccess { granted, status, error in
            if let error = error {
                reject("reminder_access_error", error.localizedDescription, error)
                return
            }
            resolve(["granted": granted, "status": self.statusString(status)])
        }
    }

    @objc
    func findEvents(_ query: NSString, startISO: NSString, endISO: NSString, limit: NSNumber, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        requestEventsAccess { granted, _, error in
            if let error = error {
                reject("calendar_access_error", error.localizedDescription, error)
                return
            }
            guard granted else {
                reject("calendar_access_denied", "Calendar access was denied.", nil)
                return
            }
            guard let start = self.parseDate(startISO as String), let end = self.parseDate(endISO as String) else {
                reject("calendar_invalid_date", "startISO and endISO must be ISO date strings.", nil)
                return
            }

            let predicate = self.eventStore.predicateForEvents(withStart: start, end: end, calendars: nil)
            let needle = (query as String).trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let max = max(1, min(limit.intValue, 25))
            let events = self.eventStore.events(matching: predicate)
                .filter { event in
                    if needle.isEmpty { return true }
                    return event.title.lowercased().contains(needle)
                        || (event.notes?.lowercased().contains(needle) ?? false)
                        || (event.location?.lowercased().contains(needle) ?? false)
                }
                .sorted { $0.startDate < $1.startDate }
                .prefix(max)
                .map(self.serializeEvent)
            resolve(Array(events))
        }
    }

    @objc
    func createEvent(_ args: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        requestEventsAccess { granted, _, error in
            if let error = error {
                reject("calendar_access_error", error.localizedDescription, error)
                return
            }
            guard granted else {
                reject("calendar_access_denied", "Calendar access was denied.", nil)
                return
            }
            guard let title = self.stringValue(args["title"]), !title.isEmpty else {
                reject("calendar_missing_title", "title is required.", nil)
                return
            }
            guard let startRaw = self.stringValue(args["start"]), let start = self.parseDate(startRaw),
                  let endRaw = self.stringValue(args["end"]), let end = self.parseDate(endRaw) else {
                reject("calendar_invalid_date", "start and end must be ISO date strings.", nil)
                return
            }

            let event = EKEvent(eventStore: self.eventStore)
            event.title = title
            event.startDate = start
            event.endDate = end
            event.isAllDay = self.boolValue(args["allDay"])
            event.location = self.stringValue(args["location"])
            event.notes = self.stringValue(args["notes"])
            event.calendar = self.calendar(named: self.stringValue(args["calendarTitle"])) ?? self.eventStore.defaultCalendarForNewEvents

            do {
                try self.eventStore.save(event, span: .thisEvent, commit: true)
                resolve(self.serializeEvent(event))
            } catch {
                reject("calendar_save_failed", error.localizedDescription, error)
            }
        }
    }

    @objc
    func findReminders(_ query: NSString, includeCompleted: Bool, limit: NSNumber, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        requestRemindersAccess { granted, _, error in
            if let error = error {
                reject("reminder_access_error", error.localizedDescription, error)
                return
            }
            guard granted else {
                reject("reminder_access_denied", "Reminders access was denied.", nil)
                return
            }

            let predicate = self.eventStore.predicateForReminders(in: nil)
            self.eventStore.fetchReminders(matching: predicate) { reminders in
                guard let reminders = reminders else {
                    reject("reminder_fetch_failed", "Could not fetch reminders.", nil)
                    return
                }
                let needle = (query as String).trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                let max = max(1, min(limit.intValue, 25))
                let result = reminders
                    .filter { reminder in
                        includeCompleted || !reminder.isCompleted
                    }
                    .filter { reminder in
                        if needle.isEmpty { return true }
                        return reminder.title.lowercased().contains(needle)
                            || (reminder.notes?.lowercased().contains(needle) ?? false)
                    }
                    .sorted { lhs, rhs in
                        let left = lhs.dueDateComponents?.date ?? Date.distantFuture
                        let right = rhs.dueDateComponents?.date ?? Date.distantFuture
                        return left < right
                    }
                    .prefix(max)
                    .map(self.serializeReminder)
                resolve(Array(result))
            }
        }
    }

    @objc
    func createReminder(_ args: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        requestRemindersAccess { granted, _, error in
            if let error = error {
                reject("reminder_access_error", error.localizedDescription, error)
                return
            }
            guard granted else {
                reject("reminder_access_denied", "Reminders access was denied.", nil)
                return
            }
            guard let title = self.stringValue(args["title"]), !title.isEmpty else {
                reject("reminder_missing_title", "title is required.", nil)
                return
            }

            let reminder = EKReminder(eventStore: self.eventStore)
            reminder.title = title
            reminder.notes = self.stringValue(args["notes"])
            reminder.priority = self.intValue(args["priority"]) ?? 0
            if let dueRaw = self.stringValue(args["due"]), let due = self.parseDate(dueRaw) {
                reminder.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: due)
            }
            reminder.calendar = self.reminderCalendar(named: self.stringValue(args["calendarTitle"])) ?? self.eventStore.defaultCalendarForNewReminders()

            do {
                try self.eventStore.save(reminder, commit: true)
                resolve(self.serializeReminder(reminder))
            } catch {
                reject("reminder_save_failed", error.localizedDescription, error)
            }
        }
    }

    @objc
    func completeReminder(_ identifier: NSString, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        requestRemindersAccess { granted, _, error in
            if let error = error {
                reject("reminder_access_error", error.localizedDescription, error)
                return
            }
            guard granted else {
                reject("reminder_access_denied", "Reminders access was denied.", nil)
                return
            }
            guard let reminder = self.eventStore.calendarItem(withIdentifier: identifier as String) as? EKReminder else {
                reject("reminder_not_found", "Reminder was not found.", nil)
                return
            }

            reminder.isCompleted = true
            reminder.completionDate = Date()
            do {
                try self.eventStore.save(reminder, commit: true)
                resolve(self.serializeReminder(reminder))
            } catch {
                reject("reminder_save_failed", error.localizedDescription, error)
            }
        }
    }

    private func requestEventsAccess(_ completion: @escaping (Bool, EKAuthorizationStatus, Error?) -> Void) {
        if #available(iOS 17.0, *) {
            eventStore.requestFullAccessToEvents { granted, error in
                completion(granted, EKEventStore.authorizationStatus(for: .event), error)
            }
        } else {
            eventStore.requestAccess(to: .event) { granted, error in
                completion(granted, EKEventStore.authorizationStatus(for: .event), error)
            }
        }
    }

    private func requestRemindersAccess(_ completion: @escaping (Bool, EKAuthorizationStatus, Error?) -> Void) {
        if #available(iOS 17.0, *) {
            eventStore.requestFullAccessToReminders { granted, error in
                completion(granted, EKEventStore.authorizationStatus(for: .reminder), error)
            }
        } else {
            eventStore.requestAccess(to: .reminder) { granted, error in
                completion(granted, EKEventStore.authorizationStatus(for: .reminder), error)
            }
        }
    }

    private func statusString(_ status: EKAuthorizationStatus) -> String {
        if status == .notDetermined {
            return "notDetermined"
        }
        if status == .restricted {
            return "restricted"
        }
        if status == .denied {
            return "denied"
        }
        if status == .authorized {
            return "authorized"
        }
        if #available(iOS 17.0, *) {
            if status == .fullAccess {
                return "fullAccess"
            }
            if status == .writeOnly {
                return "writeOnly"
            }
        }
        return "unknown"
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

    private func serializeEvent(_ event: EKEvent) -> [String: Any] {
        return [
            "identifier": event.eventIdentifier ?? "",
            "title": event.title ?? "",
            "start": isoString(event.startDate),
            "end": isoString(event.endDate),
            "allDay": event.isAllDay,
            "location": event.location ?? "",
            "notes": event.notes ?? "",
            "calendarTitle": event.calendar.title,
        ]
    }

    private func serializeReminder(_ reminder: EKReminder) -> [String: Any] {
        return [
            "identifier": reminder.calendarItemIdentifier,
            "title": reminder.title ?? "",
            "completed": reminder.isCompleted,
            "due": isoString(reminder.dueDateComponents?.date),
            "notes": reminder.notes ?? "",
            "priority": reminder.priority,
            "calendarTitle": reminder.calendar.title,
        ]
    }

    private func calendar(named title: String?) -> EKCalendar? {
        guard let title = title?.lowercased(), !title.isEmpty else {
            return nil
        }
        return eventStore.calendars(for: .event).first { $0.title.lowercased() == title }
    }

    private func reminderCalendar(named title: String?) -> EKCalendar? {
        guard let title = title?.lowercased(), !title.isEmpty else {
            return nil
        }
        return eventStore.calendars(for: .reminder).first { $0.title.lowercased() == title }
    }

    private func stringValue(_ value: Any?) -> String? {
        guard let value = value else {
            return nil
        }
        if let value = value as? String {
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }
        return nil
    }

    private func boolValue(_ value: Any?) -> Bool {
        if let value = value as? Bool {
            return value
        }
        if let value = value as? String {
            return value == "true"
        }
        return false
    }

    private func intValue(_ value: Any?) -> Int? {
        if let value = value as? Int {
            return value
        }
        if let value = value as? NSNumber {
            return value.intValue
        }
        if let value = value as? String {
            return Int(value)
        }
        return nil
    }
}
