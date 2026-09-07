-- CreateIndex
CREATE INDEX "FinancialTransaction_orderId_idx" ON "FinancialTransaction"("orderId");

-- AddForeignKey
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
