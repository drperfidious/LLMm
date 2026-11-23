//
//  DonationModule.swift
//  PocketPal
//
//  StoreKit bridge for optional LLMm support tips.
//

import Foundation
import React
import StoreKit

@objc(DonationModule)
class DonationModule: NSObject, RCTBridgeModule {
    @objc
    static func moduleName() -> String! {
        return "DonationModule"
    }

    @objc
    static func requiresMainQueueSetup() -> Bool {
        return false
    }

    @objc
    func getProducts(_ productIds: NSArray, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard #available(iOS 15.0, *) else {
            resolveOnMain(resolve, [])
            return
        }

        let ids = productIds.compactMap { $0 as? String }
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        guard !ids.isEmpty else {
            resolveOnMain(resolve, [])
            return
        }

        Task {
            do {
                let products = try await Product.products(for: ids)
                let sortedProducts = products.sorted { lhs, rhs in
                    let lhsIndex = ids.firstIndex(of: lhs.id) ?? Int.max
                    let rhsIndex = ids.firstIndex(of: rhs.id) ?? Int.max
                    return lhsIndex < rhsIndex
                }
                let serialized = sortedProducts.map { serialize(product: $0) }
                resolveOnMain(resolve, serialized)
            } catch {
                rejectOnMain(reject, code: "donation_products_failed", message: error.localizedDescription, error: error)
            }
        }
    }

    @objc
    func purchase(_ productId: NSString, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard #available(iOS 15.0, *) else {
            rejectOnMain(reject, code: "donation_unavailable", message: "Tips require iOS 15 or newer.", error: nil)
            return
        }

        let id = (productId as String).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty else {
            rejectOnMain(reject, code: "donation_missing_product", message: "A product id is required.", error: nil)
            return
        }

        Task {
            do {
                guard let product = try await Product.products(for: [id]).first else {
                    rejectOnMain(reject, code: "donation_product_not_found", message: "The selected tip is not available.", error: nil)
                    return
                }

                let result = try await product.purchase()
                switch result {
                case .success(let verificationResult):
                    switch verificationResult {
                    case .verified(let transaction):
                        await transaction.finish()
                        resolveOnMain(resolve, [
                            "status": "success",
                            "productId": transaction.productID,
                            "transactionId": String(transaction.id),
                        ])
                    case .unverified(_, let error):
                        rejectOnMain(reject, code: "donation_unverified", message: error.localizedDescription, error: error)
                    }
                case .pending:
                    resolveOnMain(resolve, [
                        "status": "pending",
                        "productId": id,
                    ])
                case .userCancelled:
                    resolveOnMain(resolve, [
                        "status": "cancelled",
                        "productId": id,
                    ])
                @unknown default:
                    resolveOnMain(resolve, [
                        "status": "unknown",
                        "productId": id,
                    ])
                }
            } catch {
                rejectOnMain(reject, code: "donation_purchase_failed", message: error.localizedDescription, error: error)
            }
        }
    }

    @available(iOS 15.0, *)
    private func serialize(product: Product) -> [String: Any] {
        return [
            "id": product.id,
            "displayName": product.displayName,
            "description": product.description,
            "displayPrice": product.displayPrice,
            "price": NSDecimalNumber(decimal: product.price).doubleValue,
        ]
    }

    private func resolveOnMain(_ resolve: @escaping RCTPromiseResolveBlock, _ value: Any) {
        DispatchQueue.main.async {
            resolve(value)
        }
    }

    private func rejectOnMain(_ reject: @escaping RCTPromiseRejectBlock, code: String, message: String, error: Error?) {
        DispatchQueue.main.async {
            reject(code, message, error)
        }
    }
}
