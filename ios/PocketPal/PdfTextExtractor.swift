//
//  PdfTextExtractor.swift
//  PocketPal
//
//  PDFKit text extraction bridge for LLMm workspace documents.
//

import Foundation
import PDFKit
import React

@objc(PdfTextExtractor)
class PdfTextExtractor: NSObject, RCTBridgeModule {
    @objc
    static func moduleName() -> String! {
        return "PdfTextExtractor"
    }

    @objc
    static func requiresMainQueueSetup() -> Bool {
        return false
    }

    @objc
    func extractText(
        _ path: NSString,
        maxChars: NSNumber,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        let rawPath = (path as String).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !rawPath.isEmpty else {
            reject("pdf_missing_path", "PDF path is required.", nil)
            return
        }

        let filePath: String
        if rawPath.hasPrefix("file://"), let url = URL(string: rawPath) {
            filePath = url.path
        } else {
            filePath = rawPath
        }

        guard FileManager.default.fileExists(atPath: filePath) else {
            reject("pdf_not_found", "PDF file was not found.", nil)
            return
        }

        let url = URL(fileURLWithPath: filePath)
        guard let document = PDFDocument(url: url) else {
            reject("pdf_open_failed", "Could not open PDF document.", nil)
            return
        }

        let limit = max(1, maxChars.intValue)
        var remaining = limit
        var truncated = false
        var parts: [String] = []

        for pageIndex in 0..<document.pageCount {
            guard remaining > 0 else {
                truncated = true
                break
            }
            guard let page = document.page(at: pageIndex) else {
                continue
            }
            let pageText = page.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if pageText.isEmpty {
                continue
            }

            let header = "Page \(pageIndex + 1):"
            let chunk = "\(header)\n\(pageText)"
            if chunk.count > remaining {
                let endIndex = chunk.index(chunk.startIndex, offsetBy: remaining)
                parts.append(String(chunk[..<endIndex]))
                truncated = true
                remaining = 0
                break
            }

            parts.append(chunk)
            remaining -= chunk.count
            if remaining > 0 {
                remaining -= 2
            }
        }

        resolve([
            "text": parts.joined(separator: "\n\n"),
            "pageCount": document.pageCount,
            "truncated": truncated,
        ])
    }
}
