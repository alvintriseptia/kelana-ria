import { createHash, timingSafeEqual } from "node:crypto";
import type { PackPaymentMode } from "@kelana-ria/contracts";

export type MidtransTransactionStatus =
  | "pending"
  | "settlement"
  | "capture"
  | "expire"
  | "cancel"
  | "deny";

export type MidtransNotificationPayload = {
  order_id: string;
  status_code: string;
  gross_amount: string;
  currency?: string;
  transaction_status: MidtransTransactionStatus;
  fraud_status?: "accept" | "challenge" | "deny";
  payment_type?: string;
  signature_key: string;
};

export type MidtransStatusResult = {
  orderId: string;
  statusCode: string;
  transactionStatus: MidtransTransactionStatus;
  fraudStatus?: "accept" | "challenge" | "deny";
  grossAmountIdr: number;
  currency: string;
  paymentType: string;
  mode: PackPaymentMode;
};

export type RedactedMidtransLifecycleEvent = {
  stage: "create-snap" | "checkout-return" | "notification" | "status-lookup";
  mode: PackPaymentMode;
  orderId: string;
  statusCode: string | null;
  transactionStatus: string;
  grossAmountIdr: number;
  currency: string;
  paymentType: string;
  signatureVerified: boolean | null;
  redacted: true;
  at: number;
};

export interface MidtransAdapter {
  readonly mode: PackPaymentMode;
  createSnapTransaction(input: {
    orderId: string;
    grossAmountIdr: number;
    packId: string;
    version: number;
    title: string;
  }): Promise<{ token: string; redirectUrl: string; mode: PackPaymentMode }>;
  verifySignature(payload: {
    order_id: string;
    status_code: string;
    gross_amount: string;
    signature_key: string;
  }): boolean;
  fetchTransactionStatus(orderId: string): Promise<MidtransStatusResult>;
  redactLifecycleEvent(input: {
    stage: RedactedMidtransLifecycleEvent["stage"];
    orderId: string;
    statusCode?: string;
    transactionStatus: string;
    grossAmountIdr: number;
    currency: string;
    paymentType?: string;
    signatureVerified?: boolean;
    at: number;
  }): RedactedMidtransLifecycleEvent;
}

export function parseMidtransIdrAmount(raw: string | number): number | undefined {
  if (typeof raw === "number") {
    return Number.isInteger(raw) && raw > 0 ? raw : undefined;
  }
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!/^\d+(?:\.00)?$/.test(trimmed)) return undefined;
  const parsed = Number.parseInt(trimmed.split(".")[0]!, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function signMidtransNotification({
  orderId,
  statusCode,
  grossAmount,
  serverKey,
}: {
  orderId: string;
  statusCode: string;
  grossAmount: string;
  serverKey: string;
}): string {
  return createHash("sha512")
    .update(`${orderId}${statusCode}${grossAmount}${serverKey}`)
    .digest("hex");
}

export function verifyMidtransSignature(
  payload: {
    order_id: string;
    status_code: string;
    gross_amount: string;
    signature_key: string;
  },
  serverKey: string,
): boolean {
  if (
    !serverKey ||
    typeof payload.signature_key !== "string" ||
    !/^[0-9a-f]{128}$/i.test(payload.signature_key)
  ) {
    return false;
  }
  const expected = signMidtransNotification({
    orderId: payload.order_id,
    statusCode: payload.status_code,
    grossAmount: payload.gross_amount,
    serverKey,
  });
  const actualBuf = Buffer.from(payload.signature_key.toLowerCase(), "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (actualBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(actualBuf, expectedBuf);
}

function makeRedactedEvent(
  mode: PackPaymentMode,
  input: Parameters<MidtransAdapter["redactLifecycleEvent"]>[0],
): RedactedMidtransLifecycleEvent {
  return {
    stage: input.stage,
    mode,
    orderId: input.orderId,
    statusCode: input.statusCode ?? null,
    transactionStatus: input.transactionStatus,
    grossAmountIdr: input.grossAmountIdr,
    currency: input.currency,
    paymentType: input.paymentType ?? "sandbox-snap",
    signatureVerified:
      input.signatureVerified === undefined ? null : input.signatureVerified,
    redacted: true,
    at: input.at,
  };
}

export function createMidtransSandboxAdapter({
  serverKey,
  snapBaseUrl = "https://app.sandbox.midtrans.com",
  apiBaseUrl = "https://api.sandbox.midtrans.com",
  fetchImpl = fetch,
}: {
  serverKey: string;
  snapBaseUrl?: string;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
}): MidtransAdapter {
  const authHeader = `Basic ${Buffer.from(`${serverKey}:`).toString("base64")}`;

  return {
    mode: "midtrans-sandbox",

    async createSnapTransaction({ orderId, grossAmountIdr, packId, version, title }) {
      const response = await fetchImpl(`${snapBaseUrl.replace(/\/$/, "")}/snap/v1/transactions`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify({
          transaction_details: {
            order_id: orderId,
            gross_amount: grossAmountIdr,
          },
          item_details: [
            {
              id: `${packId}-v${version}`,
              price: grossAmountIdr,
              quantity: 1,
              name: title.slice(0, 50),
            },
          ],
        }),
      });
      if (!response.ok) {
        throw new Error(`Midtrans Snap create failed with HTTP ${response.status}`);
      }
      const data = (await response.json()) as { token?: string; redirect_url?: string };
      if (!data.token || !data.redirect_url) {
        throw new Error("Midtrans Snap response missing token or redirect_url");
      }
      return {
        token: data.token,
        redirectUrl: data.redirect_url,
        mode: "midtrans-sandbox",
      };
    },

    verifySignature(payload) {
      return verifyMidtransSignature(payload, serverKey);
    },

    async fetchTransactionStatus(orderId) {
      const response = await fetchImpl(
        `${apiBaseUrl.replace(/\/$/, "")}/v2/${encodeURIComponent(orderId)}/status`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: authHeader,
          },
        },
      );
      if (!response.ok) {
        throw new Error(`Midtrans status lookup failed with HTTP ${response.status}`);
      }
      const data = (await response.json()) as {
        order_id?: string;
        status_code?: string;
        transaction_status?: MidtransTransactionStatus;
        fraud_status?: "accept" | "challenge" | "deny";
        gross_amount?: string;
        currency?: string;
        payment_type?: string;
      };
      const grossAmountIdr = parseMidtransIdrAmount(data.gross_amount ?? "");
      if (!data.order_id || !data.transaction_status || grossAmountIdr === undefined) {
        throw new Error("Midtrans status response incomplete");
      }
      return {
        orderId: data.order_id,
        statusCode: data.status_code ?? "200",
        transactionStatus: data.transaction_status,
        fraudStatus: data.fraud_status,
        grossAmountIdr,
        currency: data.currency ?? "IDR",
        paymentType: data.payment_type ?? "qris",
        mode: "midtrans-sandbox",
      };
    },

    redactLifecycleEvent(input) {
      return makeRedactedEvent("midtrans-sandbox", input);
    },
  };
}

export type RecordedMidtransOrderState = {
  grossAmountIdr: number;
  currency: string;
  transactionStatus: MidtransTransactionStatus;
  fraudStatus?: "accept" | "challenge" | "deny";
  statusCode: string;
  paymentType: string;
};

export type RecordedMidtransAdapter = MidtransAdapter & {
  readonly testServerKey: string;
  setOrderState(orderId: string, patch: Partial<RecordedMidtransOrderState>): void;
  setOutage(unavailable: boolean): void;
  signNotification(input: {
    orderId: string;
    statusCode?: string;
    grossAmount?: string;
    transactionStatus: MidtransTransactionStatus;
    currency?: string;
    fraudStatus?: "accept" | "challenge" | "deny";
    paymentType?: string;
  }): MidtransNotificationPayload;
};

export function createRecordedMidtransAdapter({
  serverKey = "SB-Mid-server-recorded-sandbox-test-key",
  unavailable = false,
}: {
  serverKey?: string;
  unavailable?: boolean;
} = {}): RecordedMidtransAdapter {
  const orders = new Map<string, RecordedMidtransOrderState>();
  let outage = unavailable;

  return {
    mode: "recorded-sandbox",
    testServerKey: serverKey,

    setOrderState(orderId, patch) {
      const existing = orders.get(orderId) ?? {
        grossAmountIdr: 25_000,
        currency: "IDR",
        transactionStatus: "pending" as MidtransTransactionStatus,
        statusCode: "201",
        paymentType: "qris",
      };
      orders.set(orderId, { ...existing, ...patch });
    },

    setOutage(value) {
      outage = value;
    },

    signNotification({
      orderId,
      statusCode,
      grossAmount,
      transactionStatus,
      currency,
      fraudStatus,
      paymentType,
    }) {
      const existing = orders.get(orderId);
      const resolvedStatusCode =
        statusCode ??
        (transactionStatus === "settlement" || transactionStatus === "capture"
          ? "200"
          : transactionStatus === "expire"
            ? "407"
            : "201");
      const resolvedGross =
        grossAmount ?? `${existing?.grossAmountIdr ?? 25_000}.00`;
      const resolvedCurrency = currency ?? existing?.currency ?? "IDR";
      const resolvedPaymentType = paymentType ?? existing?.paymentType ?? "qris";
      return {
        order_id: orderId,
        status_code: resolvedStatusCode,
        gross_amount: resolvedGross,
        currency: resolvedCurrency,
        transaction_status: transactionStatus,
        fraud_status: fraudStatus,
        payment_type: resolvedPaymentType,
        signature_key: signMidtransNotification({
          orderId,
          statusCode: resolvedStatusCode,
          grossAmount: resolvedGross,
          serverKey,
        }),
      };
    },

    async createSnapTransaction({ orderId, grossAmountIdr }) {
      if (outage) {
        throw new Error("Recorded sandbox payment provider unavailable");
      }
      orders.set(orderId, {
        grossAmountIdr,
        currency: "IDR",
        transactionStatus: "pending",
        statusCode: "201",
        paymentType: "qris",
      });
      return {
        token: `recorded-snap-${orderId}`,
        redirectUrl: `https://app.sandbox.midtrans.com/snap/v4/redirection/recorded-${encodeURIComponent(orderId)}`,
        mode: "recorded-sandbox",
      };
    },

    verifySignature(payload) {
      return verifyMidtransSignature(payload, serverKey);
    },

    async fetchTransactionStatus(orderId) {
      if (outage) {
        throw new Error("Recorded sandbox payment provider unavailable");
      }
      const record = orders.get(orderId);
      if (!record) {
        throw new Error(`Recorded sandbox order ${orderId} not found`);
      }
      return {
        orderId,
        statusCode: record.statusCode,
        transactionStatus: record.transactionStatus,
        fraudStatus: record.fraudStatus,
        grossAmountIdr: record.grossAmountIdr,
        currency: record.currency,
        paymentType: record.paymentType,
        mode: "recorded-sandbox",
      };
    },

    redactLifecycleEvent(input) {
      return makeRedactedEvent("recorded-sandbox", input);
    },
  };
}

export function createMidtransAdapterFromEnv(
  env: Record<string, string | undefined> = process.env,
): MidtransAdapter {
  const serverKey = env.MIDTRANS_SERVER_KEY?.trim();
  if (serverKey) {
    return createMidtransSandboxAdapter({
      serverKey,
      snapBaseUrl: env.MIDTRANS_SANDBOX_SNAP_URL?.trim() || undefined,
      apiBaseUrl: env.MIDTRANS_SANDBOX_API_URL?.trim() || undefined,
    });
  }
  return createRecordedMidtransAdapter();
}
