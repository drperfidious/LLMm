//
//  NativeMailModule.swift
//  PocketPal
//
//  Minimal TLS IMAP/SMTP bridge for LLMm mail talents.
//

import Foundation
import Network
import React

private enum NativeMailError: LocalizedError {
    case missing(String)
    case unsupported(String)
    case connection(String)
    case protocolError(String)
    case timeout

    var errorDescription: String? {
        switch self {
        case .missing(let message), .unsupported(let message), .connection(let message), .protocolError(let message):
            return message
        case .timeout:
            return "Mail server request timed out."
        }
    }
}

private struct MailServerConfig {
    let host: String
    let port: UInt16
    let security: String
}

private struct MailAccountConfig {
    let provider: String
    let accountEmail: String
    let username: String
    let password: String
    let inboxFolder: String
    let sentFolder: String
    let imap: MailServerConfig
    let smtp: MailServerConfig
}

private final class SocketConnection {
    private let host: String
    private let port: UInt16
    private let connection: NWConnection
    private let queue: DispatchQueue

    init(host: String, port: UInt16, tls: Bool) {
        self.host = host
        self.port = port
        self.queue = DispatchQueue(label: "llmm.native-mail.\(host).\(port)")
        let parameters = tls ? NWParameters.tls : NWParameters.tcp
        self.connection = NWConnection(
            host: NWEndpoint.Host(host),
            port: NWEndpoint.Port(rawValue: port)!,
            using: parameters
        )
    }

    func start() async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            final class State {
                var resumed = false
            }
            let state = State()
            connection.stateUpdateHandler = { nextState in
                guard !state.resumed else { return }
                switch nextState {
                case .ready:
                    state.resumed = true
                    continuation.resume(returning: ())
                case .failed(let error):
                    state.resumed = true
                    continuation.resume(throwing: NativeMailError.connection(error.localizedDescription))
                case .cancelled:
                    state.resumed = true
                    continuation.resume(throwing: NativeMailError.connection("Connection to \(self.host):\(self.port) was cancelled."))
                default:
                    break
                }
            }
            connection.start(queue: queue)
        }
    }

    func send(_ text: String) async throws {
        let data = Data(text.utf8)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            connection.send(content: data, completion: .contentProcessed { error in
                if let error = error {
                    continuation.resume(throwing: NativeMailError.connection(error.localizedDescription))
                } else {
                    continuation.resume(returning: ())
                }
            })
        }
    }

    func receiveChunk() async throws -> Data {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Data, Error>) in
            connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { data, _, isComplete, error in
                if let error = error {
                    continuation.resume(throwing: NativeMailError.connection(error.localizedDescription))
                    return
                }
                if let data = data, !data.isEmpty {
                    continuation.resume(returning: data)
                    return
                }
                if isComplete {
                    continuation.resume(throwing: NativeMailError.connection("Mail server closed the connection."))
                    return
                }
                continuation.resume(returning: Data())
            }
        }
    }

    func close() {
        connection.cancel()
    }
}

private func withTimeout<T>(
    seconds: Double = 30,
    operation: @escaping () async throws -> T
) async throws -> T {
    try await withThrowingTaskGroup(of: T.self) { group in
        group.addTask {
            try await operation()
        }
        group.addTask {
            try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            throw NativeMailError.timeout
        }
        guard let value = try await group.next() else {
            throw NativeMailError.timeout
        }
        group.cancelAll()
        return value
    }
}

private func stringValue(_ value: Any?, fallback: String = "") -> String {
    guard let value = value else { return fallback }
    if let string = value as? String {
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? fallback : trimmed
    }
    return fallback
}

private func intValue(_ value: Any?, fallback: Int) -> Int {
    if let number = value as? NSNumber {
        return number.intValue
    }
    if let string = value as? String, let int = Int(string.trimmingCharacters(in: .whitespacesAndNewlines)) {
        return int
    }
    return fallback
}

private func arrayOfStrings(_ value: Any?) -> [String] {
    if let array = value as? [String] {
        return array.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }
    if let string = value as? String {
        return string
            .split(separator: ",")
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }
    return []
}

private func serverConfig(_ value: Any?, defaults: MailServerConfig) -> MailServerConfig {
    guard let dict = value as? [String: Any] else { return defaults }
    return MailServerConfig(
        host: stringValue(dict["host"], fallback: defaults.host),
        port: UInt16(max(1, min(65535, intValue(dict["port"], fallback: Int(defaults.port))))),
        security: stringValue(dict["security"], fallback: defaults.security).lowercased()
    )
}

private func accountConfig(from args: NSDictionary) throws -> MailAccountConfig {
    let provider = stringValue(args["mailProvider"], fallback: "imap_smtp")
    let config = args["mailConfig"] as? [String: Any] ?? [:]
    let auth = args["mailAuth"] as? [String: Any] ?? [:]
    let accountEmail = stringValue(args["accountEmail"], fallback: stringValue(config["accountEmail"]))
    let username = stringValue(auth["username"], fallback: stringValue(config["username"], fallback: accountEmail))
    let password = stringValue(auth["password"])

    guard !accountEmail.isEmpty else {
        throw NativeMailError.missing("Mail account email is required.")
    }
    guard !username.isEmpty else {
        throw NativeMailError.missing("Mail username is required.")
    }
    guard !password.isEmpty else {
        throw NativeMailError.missing("Mail account password or app password is required.")
    }

    let defaultImap = provider == "gmail"
        ? MailServerConfig(host: "imap.gmail.com", port: 993, security: "ssl")
        : MailServerConfig(host: "", port: 993, security: "ssl")
    let defaultSmtp = provider == "gmail"
        ? MailServerConfig(host: "smtp.gmail.com", port: 465, security: "ssl")
        : MailServerConfig(host: "", port: 465, security: "ssl")
    let imap = serverConfig(config["imap"], defaults: defaultImap)
    let smtp = serverConfig(config["smtp"], defaults: defaultSmtp)

    guard !imap.host.isEmpty else {
        throw NativeMailError.missing("IMAP host is required.")
    }
    guard !smtp.host.isEmpty else {
        throw NativeMailError.missing("SMTP host is required.")
    }
    guard imap.security == "ssl" else {
        throw NativeMailError.unsupported("Direct IMAP currently supports SSL/TLS on connect. Use port 993 with security ssl.")
    }
    guard smtp.security == "ssl" else {
        throw NativeMailError.unsupported("Direct SMTP currently supports SSL/TLS on connect. Use port 465 with security ssl.")
    }

    return MailAccountConfig(
        provider: provider,
        accountEmail: accountEmail,
        username: username,
        password: password,
        inboxFolder: stringValue(config["inboxFolder"], fallback: "INBOX"),
        sentFolder: stringValue(config["sentFolder"], fallback: provider == "gmail" ? "[Gmail]/Sent Mail" : "Sent"),
        imap: imap,
        smtp: smtp
    )
}

private func imapQuote(_ value: String) -> String {
    let escaped = value
        .replacingOccurrences(of: "\\", with: "\\\\")
        .replacingOccurrences(of: "\"", with: "\\\"")
    return "\"\(escaped)\""
}

private func smtpAddress(_ value: String) -> String {
    if let start = value.lastIndex(of: "<"), let end = value.lastIndex(of: ">"), start < end {
        return String(value[value.index(after: start)..<end])
    }
    return value
}

private func regexFirst(_ pattern: String, in text: String) -> String? {
    guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
        return nil
    }
    let range = NSRange(text.startIndex..<text.endIndex, in: text)
    guard let match = regex.firstMatch(in: text, options: [], range: range), match.numberOfRanges > 1,
          let swiftRange = Range(match.range(at: 1), in: text) else {
        return nil
    }
    return String(text[swiftRange])
}

private func decodeMimeHeader(_ value: String) -> String {
    guard value.contains("=?") else { return value }
    let pattern = #"=\?([^?]+)\?([bBqQ])\?([^?]+)\?="#
    guard let regex = try? NSRegularExpression(pattern: pattern) else { return value }
    let result = NSMutableString(string: value)
    let matches = regex.matches(in: value, range: NSRange(value.startIndex..<value.endIndex, in: value)).reversed()
    for match in matches {
        guard
            let charsetRange = Range(match.range(at: 1), in: value),
            let modeRange = Range(match.range(at: 2), in: value),
            let encodedRange = Range(match.range(at: 3), in: value)
        else { continue }
        let charset = String(value[charsetRange]).lowercased()
        let mode = String(value[modeRange]).lowercased()
        let encoded = String(value[encodedRange])
        let data: Data?
        if mode == "b" {
            data = Data(base64Encoded: encoded)
        } else {
            let q = encoded
                .replacingOccurrences(of: "_", with: " ")
                .replacingOccurrences(of: "=", with: "%")
            data = q.removingPercentEncoding?.data(using: .utf8)
        }
        let decoded: String?
        if charset.contains("iso-8859-1"), let data = data {
            decoded = String(data: data, encoding: .isoLatin1)
        } else if let data = data {
            decoded = String(data: data, encoding: .utf8)
        } else {
            decoded = nil
        }
        if let decoded = decoded {
            result.replaceCharacters(in: match.range(at: 0), with: decoded)
        }
    }
    return result as String
}

private func parseHeaders(_ raw: String) -> [String: String] {
    var headers: [String: String] = [:]
    var currentKey: String?
    for line in raw.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n") {
        if line.isEmpty {
            if currentKey != nil {
                break
            }
            continue
        }
        if line.hasPrefix(" ") || line.hasPrefix("\t"), let key = currentKey {
            headers[key, default: ""] += " " + line.trimmingCharacters(in: .whitespacesAndNewlines)
            continue
        }
        guard let colon = line.firstIndex(of: ":") else { continue }
        let key = String(line[..<colon]).lowercased()
        let value = String(line[line.index(after: colon)...]).trimmingCharacters(in: .whitespacesAndNewlines)
        headers[key] = decodeMimeHeader(value)
        currentKey = key
    }
    return headers
}

private func stripHtml(_ value: String) -> String {
    value
        .replacingOccurrences(of: "(?is)<(script|style)[^>]*>.*?</\\1>", with: " ", options: .regularExpression)
        .replacingOccurrences(of: "(?s)<[^>]+>", with: " ", options: .regularExpression)
        .replacingOccurrences(of: "&nbsp;", with: " ")
        .replacingOccurrences(of: "&amp;", with: "&")
        .replacingOccurrences(of: "&lt;", with: "<")
        .replacingOccurrences(of: "&gt;", with: ">")
        .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        .trimmingCharacters(in: .whitespacesAndNewlines)
}

private func decodeQuotedPrintable(_ value: String) -> String {
    let normalized = value
        .replacingOccurrences(of: "=\r\n", with: "")
        .replacingOccurrences(of: "=\n", with: "")
    var bytes: [UInt8] = []
    let scalars = Array(normalized.utf8)
    var index = 0
    while index < scalars.count {
        if scalars[index] == 61, index + 2 < scalars.count {
            let hex = String(bytes: [scalars[index + 1], scalars[index + 2]], encoding: .ascii) ?? ""
            if let byte = UInt8(hex, radix: 16) {
                bytes.append(byte)
                index += 3
                continue
            }
        }
        bytes.append(scalars[index])
        index += 1
    }
    return String(data: Data(bytes), encoding: .utf8) ?? normalized
}

private func stringFromMailData(_ data: Data, charset: String?) -> String? {
    let normalized = charset?.lowercased().trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if normalized.contains("iso-8859-1") || normalized.contains("latin1") {
        return String(data: data, encoding: .isoLatin1)
    }
    if normalized.contains("us-ascii") {
        return String(data: data, encoding: .ascii)
    }
    if normalized.contains("utf-16") {
        return String(data: data, encoding: .utf16)
    }
    return String(data: data, encoding: .utf8)
        ?? String(data: data, encoding: .isoLatin1)
        ?? String(data: data, encoding: .ascii)
}

private func splitHeaderBody(_ raw: String) -> (headers: [String: String], body: String) {
    let normalized = raw.replacingOccurrences(of: "\r\n", with: "\n")
    guard let range = normalized.range(of: "\n\n") else {
        return ([:], normalized)
    }
    return (
        parseHeaders(String(normalized[..<range.lowerBound])),
        String(normalized[range.upperBound...])
    )
}

private func charsetFromContentType(_ contentType: String) -> String? {
    regexFirst(#"charset\s*=\s*"?([^";\s]+)"?"#, in: contentType)
}

private func boundaryFromContentType(_ contentType: String) -> String? {
    regexFirst(#"boundary\s*=\s*"?([^";]+)"?"#, in: contentType)?
        .trimmingCharacters(in: .whitespacesAndNewlines)
}

private func decodeTransferBody(_ body: String, headers: [String: String]) -> String {
    let encoding = headers["content-transfer-encoding"]?.lowercased() ?? ""
    let contentType = headers["content-type"] ?? ""
    let charset = charsetFromContentType(contentType)

    if encoding.contains("base64"),
       let data = Data(base64Encoded: body.replacingOccurrences(of: "\\s+", with: "", options: .regularExpression)),
       let string = stringFromMailData(data, charset: charset) {
        return string
    }
    if encoding.contains("quoted-printable") {
        let decoded = decodeQuotedPrintable(body)
        if let data = decoded.data(using: .utf8),
           let string = stringFromMailData(data, charset: charset) {
            return string
        }
        return decoded
    }
    return body
}

private func trimMimePart(_ value: String) -> String {
    var out = value
    while out.hasPrefix("\n") || out.hasPrefix("\r") {
        out.removeFirst()
    }
    while out.hasSuffix("\n") || out.hasSuffix("\r") {
        out.removeLast()
    }
    return out
}

private func bodyFromEntity(headers: [String: String], body: String, depth: Int = 0) -> String {
    if depth > 8 {
        return stripHtml(decodeTransferBody(body, headers: headers))
    }

    let contentType = headers["content-type"]?.lowercased() ?? ""
    if contentType.contains("multipart/"),
       let boundary = boundaryFromContentType(headers["content-type"] ?? "") {
        let delimiter = "--\(boundary)"
        let rawParts = body.components(separatedBy: delimiter).dropFirst()
        var candidates: [(priority: Int, text: String)] = []
        for rawPart in rawParts {
            let part = trimMimePart(rawPart)
            if part.hasPrefix("--") {
                break
            }
            let split = splitHeaderBody(part)
            let disposition = split.headers["content-disposition"]?.lowercased() ?? ""
            if disposition.contains("attachment") {
                continue
            }
            let partType = split.headers["content-type"]?.lowercased() ?? ""
            let text = bodyFromEntity(headers: split.headers, body: split.body, depth: depth + 1)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if text.isEmpty {
                continue
            }
            let priority: Int
            if partType.contains("text/plain") {
                priority = 0
            } else if partType.contains("text/html") {
                priority = 1
            } else {
                priority = 2
            }
            candidates.append((priority, text))
        }
        if let best = candidates.sorted(by: {
            if $0.priority != $1.priority {
                return $0.priority < $1.priority
            }
            return $0.text.count > $1.text.count
        }).first {
            return best.text
        }
    }

    let decoded = decodeTransferBody(body, headers: headers)

    if contentType.contains("text/html") || decoded.range(of: #"<[a-z][\s\S]*>"#, options: .regularExpression) != nil {
        return stripHtml(decoded)
    }
    return decoded.trimmingCharacters(in: .whitespacesAndNewlines)
}

private func bodyFromMessage(_ raw: String) -> String {
    let split = splitHeaderBody(raw)
    if split.headers.isEmpty {
        return stripHtml(raw.replacingOccurrences(of: "\r\n", with: "\n"))
    }
    return bodyFromEntity(headers: split.headers, body: split.body)
}

private func extractFetchLiteral(_ response: String, tag: String) -> String {
    let pattern = #"(?s)\{\d+\}\r?\n([\s\S]*?)\r?\n\)?\r?\n"# + NSRegularExpression.escapedPattern(for: tag) + #"\s+(OK|NO|BAD)"#
    if let literal = regexFirst(pattern, in: response) {
        return literal
    }
    return response
}

private func extractTextPreview(_ response: String) -> String {
    return bodyFromMessage(response)
        .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        .trimmingCharacters(in: .whitespacesAndNewlines)
}

private func parseSearchUIDs(_ response: String) -> [String] {
    var uids: [String] = []
    for line in response.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n") {
        guard line.uppercased().hasPrefix("* SEARCH") else { continue }
        uids.append(contentsOf: line.split(separator: " ").dropFirst(2).map(String.init))
    }
    return uids.filter { !$0.isEmpty }
}

private final class ImapClient {
    private let config: MailAccountConfig
    private var counter = 1

    init(config: MailAccountConfig) {
        self.config = config
    }

    private func nextTag() -> String {
        let tag = "A\(String(format: "%04d", counter))"
        counter += 1
        return tag
    }

    private func readUntil(_ connection: SocketConnection, _ stop: @escaping (String) -> Bool, maxBytes: Int = 1024 * 1024) async throws -> String {
        var data = Data()
        while true {
            if let text = String(data: data, encoding: .utf8), stop(text) {
                return text
            }
            if data.count > maxBytes {
                throw NativeMailError.protocolError("Mail server response exceeded the app safety limit.")
            }
            let chunk = try await connection.receiveChunk()
            if chunk.isEmpty {
                continue
            }
            data.append(chunk)
        }
    }

    private func readTagged(_ connection: SocketConnection, tag: String, maxBytes: Int = 1024 * 1024) async throws -> String {
        try await readUntil(connection, { text in
            text.range(of: #"(?m)^\#(tag)\s+(OK|NO|BAD)"#, options: .regularExpression) != nil
        }, maxBytes: maxBytes)
    }

    private func assertOK(_ response: String, tag: String, action: String) throws {
        if response.range(of: #"(?m)^\#(tag)\s+OK"#, options: .regularExpression) != nil {
            return
        }
        let last = response
            .replacingOccurrences(of: "\r\n", with: "\n")
            .split(separator: "\n")
            .last
            .map(String.init) ?? response
        throw NativeMailError.protocolError("\(action) failed: \(last)")
    }

    private func command(_ connection: SocketConnection, _ command: String, action: String, maxBytes: Int = 1024 * 1024) async throws -> (String, String) {
        let tag = nextTag()
        try await connection.send("\(tag) \(command)\r\n")
        let response = try await readTagged(connection, tag: tag, maxBytes: maxBytes)
        try assertOK(response, tag: tag, action: action)
        return (tag, response)
    }

    private func connect() async throws -> SocketConnection {
        let connection = SocketConnection(host: config.imap.host, port: config.imap.port, tls: true)
        try await connection.start()
        _ = try await readUntil(connection, { $0.contains("\r\n") }, maxBytes: 64 * 1024)
        _ = try await command(
            connection,
            "LOGIN \(imapQuote(config.username)) \(imapQuote(config.password))",
            action: "IMAP login"
        )
        return connection
    }

    func check() async throws -> [String: Any] {
        try await withTimeout {
            let connection = try await self.connect()
            defer { connection.close() }
            let (_, capability) = try await self.command(connection, "CAPABILITY", action: "IMAP capability")
            let (_, foldersResponse) = try await self.command(connection, #"LIST "" "*""#, action: "IMAP folder list")
            _ = try? await self.command(connection, "LOGOUT", action: "IMAP logout")
            let folders = foldersResponse
                .replacingOccurrences(of: "\r\n", with: "\n")
                .components(separatedBy: "\n")
                .compactMap { line -> String? in
                    guard line.uppercased().hasPrefix("* LIST") else { return nil }
                    if let quoted = regexFirst(#""([^"]+)"\s*$"#, in: line) {
                        return quoted
                    }
                    return line.split(separator: " ").last.map(String.init)
                }
            let serverCaps = capability
                .replacingOccurrences(of: "\r\n", with: "\n")
                .components(separatedBy: "\n")
                .first(where: { $0.uppercased().hasPrefix("* CAPABILITY") })?
                .split(separator: " ")
                .dropFirst()
                .map(String.init) ?? []
            return [
                "ok": true,
                "provider": "native-\(self.config.provider)",
                "accountEmail": self.config.accountEmail,
                "capabilities": Array(Set(["search", "read", "send"] + serverCaps)).sorted(),
                "folders": Array(folders.prefix(24)),
            ]
        }
    }

    func search(query: String, folder: String, limit: Int) async throws -> [String: Any] {
        try await withTimeout(seconds: 45) {
            let connection = try await self.connect()
            defer { connection.close() }
            _ = try await self.command(connection, "SELECT \(imapQuote(folder))", action: "IMAP select")
            let searchCommand = query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? "UID SEARCH ALL"
                : "UID SEARCH CHARSET UTF-8 TEXT \(imapQuote(query))"
            let (_, searchResponse) = try await self.command(connection, searchCommand, action: "IMAP search", maxBytes: 256 * 1024)
            let uids = Array(parseSearchUIDs(searchResponse).suffix(max(1, limit)).reversed())
            var messages: [[String: Any]] = []
            for uid in uids {
                let (fetchTag, fetchResponse) = try await self.command(
                    connection,
                    "UID FETCH \(uid) (UID BODY.PEEK[]<0.65536>)",
                    action: "IMAP fetch preview",
                    maxBytes: 384 * 1024
                )
                let raw = extractFetchLiteral(fetchResponse, tag: fetchTag)
                let headers = parseHeaders(raw)
                let snippet = extractTextPreview(raw)
                messages.append([
                    "id": uid,
                    "messageId": headers["message-id"] ?? uid,
                    "from": headers["from"] ?? "",
                    "to": headers["to"] ?? "",
                    "cc": headers["cc"] ?? "",
                    "subject": headers["subject"] ?? "(no subject)",
                    "date": headers["date"] ?? "",
                    "snippet": String(snippet.prefix(360)),
                    "folder": folder,
                ])
            }
            _ = try? await self.command(connection, "LOGOUT", action: "IMAP logout")
            return [
                "ok": true,
                "provider": "native-\(self.config.provider)",
                "accountEmail": self.config.accountEmail,
                "messages": messages,
            ]
        }
    }

    func read(id: String, folder: String) async throws -> [String: Any] {
        try await withTimeout(seconds: 45) {
            let connection = try await self.connect()
            defer { connection.close() }
            _ = try await self.command(connection, "SELECT \(imapQuote(folder))", action: "IMAP select")
            let (tag, response) = try await self.command(
                connection,
                "UID FETCH \(id) (UID BODY.PEEK[])",
                action: "IMAP read",
                maxBytes: 1024 * 1024
            )
            let raw = extractFetchLiteral(response, tag: tag)
            let headers = parseHeaders(raw)
            let body = bodyFromMessage(raw)
            _ = try? await self.command(connection, "LOGOUT", action: "IMAP logout")
            return [
                "ok": true,
                "provider": "native-\(self.config.provider)",
                "accountEmail": self.config.accountEmail,
                "message": [
                    "id": id,
                    "messageId": headers["message-id"] ?? id,
                    "from": headers["from"] ?? "",
                    "to": headers["to"] ?? "",
                    "cc": headers["cc"] ?? "",
                    "subject": headers["subject"] ?? "(no subject)",
                    "date": headers["date"] ?? "",
                    "body": body,
                    "folder": folder,
                ],
            ]
        }
    }
}

private final class SmtpClient {
    private let config: MailAccountConfig

    init(config: MailAccountConfig) {
        self.config = config
    }

    private func readSmtp(_ connection: SocketConnection, code: String) async throws -> String {
        var data = Data()
        while true {
            if let text = String(data: data, encoding: .utf8) {
                let lines = text.replacingOccurrences(of: "\r\n", with: "\n").split(separator: "\n").map(String.init)
                if lines.contains(where: { $0.hasPrefix("\(code) ") }) {
                    return text
                }
                if let last = lines.last, let first = last.first, first >= "4" {
                    throw NativeMailError.protocolError(last)
                }
            }
            if data.count > 512 * 1024 {
                throw NativeMailError.protocolError("SMTP server response exceeded the app safety limit.")
            }
            data.append(try await connection.receiveChunk())
        }
    }

    private func command(_ connection: SocketConnection, _ command: String, expect code: String) async throws -> String {
        try await connection.send("\(command)\r\n")
        return try await readSmtp(connection, code: code)
    }

    func send(to: [String], cc: [String], bcc: [String], subject: String, body: String) async throws -> [String: Any] {
        try await withTimeout(seconds: 45) {
            let connection = SocketConnection(host: self.config.smtp.host, port: self.config.smtp.port, tls: true)
            try await connection.start()
            defer { connection.close() }
            _ = try await self.readSmtp(connection, code: "220")
            _ = try await self.command(connection, "EHLO llmm.local", expect: "250")
            _ = try await self.command(connection, "AUTH LOGIN", expect: "334")
            _ = try await self.command(connection, Data(self.config.username.utf8).base64EncodedString(), expect: "334")
            _ = try await self.command(connection, Data(self.config.password.utf8).base64EncodedString(), expect: "235")
            _ = try await self.command(connection, "MAIL FROM:<\(smtpAddress(self.config.accountEmail))>", expect: "250")
            for recipient in to + cc + bcc {
                _ = try await self.command(connection, "RCPT TO:<\(smtpAddress(recipient))>", expect: "250")
            }
            _ = try await self.command(connection, "DATA", expect: "354")
            let date = DateFormatter.rfc2822.string(from: Date())
            let messageId = "<\(UUID().uuidString.lowercased())@llmm.local>"
            let safeBody = body
                .replacingOccurrences(of: "\r\n", with: "\n")
                .replacingOccurrences(of: "\n.", with: "\n..")
                .replacingOccurrences(of: "\n", with: "\r\n")
            let message = [
                "From: \(self.config.accountEmail)",
                "To: \(to.joined(separator: ", "))",
                cc.isEmpty ? "" : "Cc: \(cc.joined(separator: ", "))",
                "Subject: \(subject.replacingOccurrences(of: "\r\n", with: " "))",
                "Date: \(date)",
                "Message-ID: \(messageId)",
                "MIME-Version: 1.0",
                "Content-Type: text/plain; charset=utf-8",
                "Content-Transfer-Encoding: 8bit",
                "",
                safeBody,
                ".",
                "",
            ].filter { !$0.isEmpty }.joined(separator: "\r\n")
            try await connection.send(message)
            _ = try await self.readSmtp(connection, code: "250")
            _ = try? await self.command(connection, "QUIT", expect: "221")
            return [
                "ok": true,
                "provider": "native-\(self.config.provider)",
                "accountEmail": self.config.accountEmail,
                "id": messageId,
                "summary": "Sent \"\(subject)\" to \(to.joined(separator: ", ")).",
            ]
        }
    }
}

private extension DateFormatter {
    static let rfc2822: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss Z"
        return formatter
    }()
}

@objc(NativeMailModule)
class NativeMailModule: NSObject, RCTBridgeModule {
    @objc
    static func moduleName() -> String! {
        return "NativeMailModule"
    }

    @objc
    static func requiresMainQueueSetup() -> Bool {
        return false
    }

    @objc
    func check(_ args: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                let config = try accountConfig(from: args)
                let result = try await ImapClient(config: config).check()
                resolve(result)
            } catch {
                reject("native_mail_check_failed", error.localizedDescription, error)
            }
        }
    }

    @objc
    func search(_ args: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                let config = try accountConfig(from: args)
                let query = stringValue(args["query"])
                let folder = stringValue(args["folder"], fallback: config.inboxFolder)
                let limit = max(1, min(25, intValue(args["limit"], fallback: 5)))
                let result = try await ImapClient(config: config).search(query: query, folder: folder, limit: limit)
                resolve(result)
            } catch {
                reject("native_mail_search_failed", error.localizedDescription, error)
            }
        }
    }

    @objc
    func read(_ args: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                let config = try accountConfig(from: args)
                let id = stringValue(args["id"], fallback: stringValue(args["messageId"]))
                guard !id.isEmpty else {
                    throw NativeMailError.missing("Mail message id is required.")
                }
                let folder = stringValue(args["folder"], fallback: config.inboxFolder)
                let result = try await ImapClient(config: config).read(id: id, folder: folder)
                resolve(result)
            } catch {
                reject("native_mail_read_failed", error.localizedDescription, error)
            }
        }
    }

    @objc
    func send(_ args: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                let config = try accountConfig(from: args)
                let to = arrayOfStrings(args["to"])
                let cc = arrayOfStrings(args["cc"])
                let bcc = arrayOfStrings(args["bcc"])
                let subject = stringValue(args["subject"])
                let body = stringValue(args["body"])
                guard !to.isEmpty else {
                    throw NativeMailError.missing("At least one recipient is required.")
                }
                guard !subject.isEmpty else {
                    throw NativeMailError.missing("Email subject is required.")
                }
                guard !body.isEmpty else {
                    throw NativeMailError.missing("Email body is required.")
                }
                let result = try await SmtpClient(config: config).send(to: to, cc: cc, bcc: bcc, subject: subject, body: body)
                resolve(result)
            } catch {
                reject("native_mail_send_failed", error.localizedDescription, error)
            }
        }
    }
}
