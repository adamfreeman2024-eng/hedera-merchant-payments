-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('OPEN', 'SETTLED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "chainId" BYTEA NOT NULL,
    "merchantId" TEXT NOT NULL,
    "merchantAccount" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "tokenEvmAddress" TEXT,
    "amount" DECIMAL(30,0) NOT NULL,
    "memo" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),
    "paidBy" TEXT,
    "paymentTxId" TEXT,
    "hcsSequence" INTEGER,
    "onChainTxHash" TEXT,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "statusCode" INTEGER,
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    "lastError" TEXT,
    "signature" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_chainId_key" ON "Invoice"("chainId");

-- CreateIndex
CREATE INDEX "Invoice_status_expiresAt_idx" ON "Invoice"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "Invoice_merchantId_createdAt_idx" ON "Invoice"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_delivered_createdAt_idx" ON "WebhookDelivery"("delivered", "createdAt");

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
