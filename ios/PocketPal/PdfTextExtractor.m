//
//  PdfTextExtractor.m
//  PocketPal
//
//  Objective-C bridge for PdfTextExtractor.
//

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(PdfTextExtractor, NSObject)

RCT_EXTERN_METHOD(extractText:(NSString *)path
                  maxChars:(nonnull NSNumber *)maxChars
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
