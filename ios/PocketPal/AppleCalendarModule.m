//
//  AppleCalendarModule.m
//  PocketPal
//
//  Objective-C bridge for AppleCalendarModule.
//

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(AppleCalendarModule, NSObject)

RCT_EXTERN_METHOD(getAuthorizationStatus:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(requestCalendarAccess:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(requestReminderAccess:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(findEvents:(NSString *)query
                  startISO:(NSString *)startISO
                  endISO:(NSString *)endISO
                  limit:(nonnull NSNumber *)limit
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(createEvent:(NSDictionary *)args
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(findReminders:(NSString *)query
                  includeCompleted:(BOOL)includeCompleted
                  limit:(nonnull NSNumber *)limit
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(createReminder:(NSDictionary *)args
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(completeReminder:(NSString *)identifier
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
