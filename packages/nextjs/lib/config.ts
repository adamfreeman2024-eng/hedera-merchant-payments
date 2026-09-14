/**
 * Runtime configuration.
 *
 * Hard rule from the acceptance contract: the dashboard and checkout must render
 * with NO configuration at all. So every value here has a safe default and nothing
 * throws at import time — pages check the `has*` flags and degrade to a helpful state.
 */

const env = (key: string, fallback = ""): string => {
  const value = process.env[key];
  return value === undefined || value === "" ? fallback : value;
};

export const config = {
  network: env("NEXT_PUBLIC_HEDERA_NETWORK", env("HEDERA_NETWORK", "testnet")),

  // Merchant side (server-only values stay server-side; the public ones are re-read below).
  merchantAccountId: env("MERCHANT_ACCOUNT_ID", env("NEXT_PUBLIC_MERCHANT_ACCOUNT_ID")),
  paymentTokenId: env("PAYMENT_TOKEN_ID", env("NEXT_PUBLIC_PAYMENT_TOKEN_ID")),
  registryAddress: env("INVOICE_REGISTRY_ADDRESS", env("NEXT_PUBLIC_INVOICE_REGISTRY_ADDRESS")),
  hcsTopicId: env("HCS_RECEIPT_TOPIC_ID"),
  webhookUrl: env("MERCHANT_WEBHOOK_URL"),

  databaseUrl: env("DATABASE_URL"),
  walletConnectProjectId: env("NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID"),

  defaultInvoiceTtlMinutes: Number(env("DEFAULT_INVOICE_TTL_MINUTES", "30")),
} as const;

export const hasDatabase = () => Boolean(config.databaseUrl);
export const hasMerchant = () => Boolean(config.merchantAccountId);
export const hasRegistry = () => Boolean(config.registryAddress);
export const hasHcsTopic = () => Boolean(config.hcsTopicId);
export const hasWalletConnect = () => Boolean(config.walletConnectProjectId);

/** Mirror Node base URL for the configured network. */
export const mirrorBase = () =>
  config.network === "mainnet"
    ? "https://mainnet-public.mirrornode.hedera.com"
    : "https://testnet.mirrornode.hedera.com";

export const explorerBase = () => (config.network === "mainnet" ? "https://hashscan.io/mainnet" : "https://hashscan.io/testnet");

export const explorerAccount = (accountId: string) => `${explorerBase()}/account/${accountId}`;
export const explorerTransaction = (txId: string) => `${explorerBase()}/transaction/${txId.replace("@", "-")}`;
export const explorerTopic = (topicId: string) => `${explorerBase()}/topic/${topicId}`;
export const explorerContract = (address: string) => `${explorerBase()}/contract/${address}`;

/** Public config safe to hand to client components. */
export const publicConfig = {
  network: config.network,
  merchantAccountId: config.merchantAccountId,
  paymentTokenId: config.paymentTokenId,
  registryAddress: config.registryAddress,
  walletConnectProjectId: config.walletConnectProjectId,
  hcsTopicId: config.hcsTopicId,
};
