//
//  DonationModule.m
//  PocketPal
//
//  Objective-C bridge for DonationModule.
//

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(DonationModule, NSObject)

RCT_EXTERN_METHOD(getProducts:(NSArray *)productIds
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(purchase:(NSString *)productId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
