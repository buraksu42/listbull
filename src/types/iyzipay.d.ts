/**
 * Minimal type shim for `iyzipay` (Iyzico's official Node SDK ships
 * untyped). Phase 5 uses only the subscription checkout-form
 * initialize call + the constructor; expand here as we wire more
 * surfaces (subscription cancel, customer retrieve, etc).
 */
declare module "iyzipay" {
  type Callback<T> = (err: Error | null, result: T) => void;

  type Config = {
    uri: string;
    apiKey: string;
    secretKey: string;
  };

  type SubscriptionCheckoutInitParams = {
    locale?: "tr" | "en";
    conversationId?: string;
    pricingPlanReferenceCode: string;
    subscriptionInitialStatus?: "ACTIVE" | "PENDING";
    callbackUrl: string;
    customer: {
      name: string;
      surname: string;
      identityNumber?: string;
      email: string;
      gsmNumber?: string;
      billingAddress: {
        contactName: string;
        city: string;
        country: string;
        address: string;
        zipCode?: string;
      };
      shippingAddress?: {
        contactName: string;
        city: string;
        country: string;
        address: string;
        zipCode?: string;
      };
    };
  };

  type SubscriptionCheckoutInitResult = {
    status: "success" | "failure";
    errorCode?: string;
    errorMessage?: string;
    token?: string;
    checkoutFormContent?: string;
    tokenExpireTime?: number;
    referenceCode?: string;
  };

  type SubscriptionPaymentRetrieveResult = {
    status: "success" | "failure";
    errorCode?: string;
    errorMessage?: string;
    referenceCode?: string;
    parentReferenceCode?: string;
    pricingPlanReferenceCode?: string;
    customerReferenceCode?: string;
    subscriptionStatus?:
      | "ACTIVE"
      | "PENDING"
      | "CANCELED"
      | "EXPIRED"
      | "UNPAID";
    startDate?: number;
    endDate?: number;
  };

  class Iyzipay {
    constructor(config: Config);

    subscriptionCheckoutForm: {
      initialize: (
        params: SubscriptionCheckoutInitParams,
        cb: Callback<SubscriptionCheckoutInitResult>,
      ) => void;
      retrieve: (
        params: { checkoutFormToken: string },
        cb: Callback<SubscriptionPaymentRetrieveResult>,
      ) => void;
    };

    static LOCALE: { TR: "tr"; EN: "en" };
  }

  export = Iyzipay;
}
