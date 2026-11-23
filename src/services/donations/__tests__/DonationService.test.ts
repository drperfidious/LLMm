import {NativeModules, Platform} from 'react-native';

import {
  DONATION_PRODUCT_IDS,
  getDonationProducts,
  purchaseDonation,
} from '../DonationService';

describe('DonationService', () => {
  const originalOS = Platform.OS;
  const originalDonationModule = NativeModules.DonationModule;
  const originalE2E = (global as any).__E2E__;

  afterEach(() => {
    Platform.OS = originalOS;
    NativeModules.DonationModule = originalDonationModule;
    (global as any).__E2E__ = originalE2E;
    jest.clearAllMocks();
  });

  it('returns a local tip product in E2E builds when StoreKit products are unavailable', async () => {
    Platform.OS = 'ios';
    NativeModules.DonationModule = {
      getProducts: jest.fn().mockResolvedValue([]),
      purchase: jest.fn(),
    };
    (global as any).__E2E__ = true;

    await expect(getDonationProducts()).resolves.toEqual([
      expect.objectContaining({
        id: DONATION_PRODUCT_IDS[0],
        displayName: 'Small Tip',
        displayPrice: '$1.99',
      }),
    ]);
  });

  it('does not synthesize a product outside E2E builds', async () => {
    Platform.OS = 'ios';
    NativeModules.DonationModule = {
      getProducts: jest.fn().mockResolvedValue([]),
      purchase: jest.fn(),
    };
    (global as any).__E2E__ = false;

    await expect(getDonationProducts()).resolves.toEqual([]);
  });

  it('uses a local success result for the configured product in E2E builds when purchase cannot reach StoreKit', async () => {
    Platform.OS = 'ios';
    NativeModules.DonationModule = {
      getProducts: jest.fn(),
      purchase: jest.fn().mockRejectedValue(new Error('StoreKit unavailable')),
    };
    (global as any).__E2E__ = true;

    await expect(purchaseDonation(DONATION_PRODUCT_IDS[0])).resolves.toEqual({
      status: 'success',
      productId: DONATION_PRODUCT_IDS[0],
      transactionId: 'local-storekit-preview',
    });
  });
});
