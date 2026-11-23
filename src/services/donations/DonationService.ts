import {NativeModules, Platform} from 'react-native';

export const DONATION_PRODUCT_IDS = [
  'com.randyduquette.llmm.tip.small',
] as const;

export type DonationProduct = {
  id: string;
  displayName: string;
  description: string;
  displayPrice: string;
  price?: number;
};

export type DonationPurchaseResult = {
  status: 'success' | 'pending' | 'cancelled' | 'unknown';
  productId: string;
  transactionId?: string;
};

const E2E_DONATION_PRODUCTS: DonationProduct[] = [
  {
    id: DONATION_PRODUCT_IDS[0],
    displayName: 'Small Tip',
    description: 'Optional support for LLMm development.',
    displayPrice: '$1.99',
    price: 1.99,
  },
];

type NativeDonationModule = {
  getProducts(productIds: readonly string[]): Promise<DonationProduct[]>;
  purchase(productId: string): Promise<DonationPurchaseResult>;
};

function getModule(): NativeDonationModule | null {
  const module = NativeModules.DonationModule as
    | NativeDonationModule
    | undefined;
  if (Platform.OS !== 'ios' || !module?.getProducts || !module?.purchase) {
    return null;
  }
  return module;
}

function isConfiguredDonationProduct(productId: string): boolean {
  return DONATION_PRODUCT_IDS.includes(
    productId as (typeof DONATION_PRODUCT_IDS)[number],
  );
}

export async function getDonationProducts(
  productIds: readonly string[] = DONATION_PRODUCT_IDS,
): Promise<DonationProduct[]> {
  const module = getModule();
  if (!module) {
    return __E2E__ ? E2E_DONATION_PRODUCTS : [];
  }
  try {
    const products = await module.getProducts(productIds);
    if (products.length > 0) {
      return products;
    }
  } catch (error) {
    if (!__E2E__) {
      throw error;
    }
  }
  return __E2E__ ? E2E_DONATION_PRODUCTS : [];
}

export async function purchaseDonation(
  productId: string,
): Promise<DonationPurchaseResult> {
  const module = getModule();
  if (!module) {
    if (__E2E__ && isConfiguredDonationProduct(productId)) {
      return {
        status: 'success',
        productId,
        transactionId: 'local-storekit-preview',
      };
    }
    throw new Error('Tips are available on iOS through App Store purchases.');
  }
  try {
    return await module.purchase(productId);
  } catch (error) {
    if (__E2E__ && isConfiguredDonationProduct(productId)) {
      return {
        status: 'success',
        productId,
        transactionId: 'local-storekit-preview',
      };
    }
    throw error;
  }
}
