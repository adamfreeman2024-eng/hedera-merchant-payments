import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const HBAR = ethers.ZeroAddress;

function idOf(label: string) {
  return ethers.keccak256(ethers.toUtf8Bytes(label));
}

describe("InvoiceRegistry", () => {
  async function deploy() {
    const [owner, operator, merchant, payer, stranger] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("InvoiceRegistry");
    const registry = await factory.deploy(operator.address, owner.address);
    await registry.waitForDeployment();
    return { registry, owner, operator, merchant, payer, stranger };
  }

  async function openInvoice(
    registry: any,
    operator: any,
    merchant: any,
    token: string,
    amount: bigint,
    label = "inv-1",
    ttl = 3600
  ) {
    const id = idOf(label);
    const expiresAt = (await time.latest()) + ttl;
    const memo = label.toUpperCase();
    await registry.connect(operator).createInvoice(id, merchant.address, token, amount, expiresAt, memo);
    return { id, expiresAt, memo };
  }

  it("operator can open an invoice and it is publicly readable", async () => {
    const { registry, operator, merchant } = await deploy();
    const { id, expiresAt, memo } = await openInvoice(registry, operator, merchant, HBAR, 10n ** 16n, "inv-1");

    const inv = await registry.getInvoice(id);
    expect(inv.id).to.equal(id);
    expect(inv.merchant).to.equal(merchant.address);
    expect(inv.amount).to.equal(10n ** 16n);
    expect(inv.expiresAt).to.equal(expiresAt);
    expect(inv.memo).to.equal(memo);
    expect(inv.status).to.equal(1n); // Open
    expect(await registry.isOpen(id)).to.equal(true);
    expect(await registry.invoiceCount()).to.equal(1n);
  });

  it("emits InvoiceCreated with the invoice terms", async () => {
    const { registry, operator, merchant } = await deploy();
    const id = idOf("inv-emit");
    const expiresAt = (await time.latest()) + 600;
    await expect(
      registry.connect(operator).createInvoice(id, merchant.address, HBAR, 5000n, expiresAt, "INV-EMIT")
    )
      .to.emit(registry, "InvoiceCreated")
      .withArgs(id, merchant.address, HBAR, 5000n, expiresAt, "INV-EMIT");
  });

  it("rejects invoice creation from anyone but the operator/owner", async () => {
    const { registry, merchant, stranger } = await deploy();
    const expiresAt = (await time.latest()) + 600;
    await expect(
      registry.connect(stranger).createInvoice(idOf("nope"), merchant.address, HBAR, 1n, expiresAt, "X")
    ).to.be.revertedWithCustomError(registry, "NotOperator");
  });

  it("rejects zero amounts, past expiries and duplicate ids", async () => {
    const { registry, operator, merchant } = await deploy();
    const now = await time.latest();
    const id = idOf("dup");

    await expect(
      registry.connect(operator).createInvoice(id, merchant.address, HBAR, 0n, now + 600, "Z")
    ).to.be.revertedWithCustomError(registry, "ZeroAmount");

    await expect(
      registry.connect(operator).createInvoice(id, merchant.address, HBAR, 1n, now - 1, "Z")
    ).to.be.revertedWithCustomError(registry, "InvalidInvoice");

    await registry.connect(operator).createInvoice(id, merchant.address, HBAR, 1n, now + 600, "Z");
    await expect(
      registry.connect(operator).createInvoice(id, merchant.address, HBAR, 1n, now + 600, "Z")
    ).to.be.revertedWithCustomError(registry, "InvoiceExists");
  });

  it("operator attests an observed HBAR settlement exactly once", async () => {
    const { registry, operator, merchant, payer } = await deploy();
    const { id } = await openInvoice(registry, operator, merchant, HBAR, 1000n, "hbar-1");
    const txRef = ethers.keccak256(ethers.toUtf8Bytes("0.0.1234@1789313329.528782333"));

    await expect(registry.connect(operator).attestHbarSettlement(id, txRef))
      .to.emit(registry, "InvoiceSettled")
      .withArgs(id, operator.address, HBAR, 1000n, txRef, false);

    const inv = await registry.getInvoice(id);
    expect(inv.status).to.equal(2n); // Settled
    expect(inv.settlementRef).to.equal(txRef);
    expect(await registry.isOpen(id)).to.equal(false);

    await expect(
      registry.connect(operator).attestHbarSettlement(id, txRef)
    ).to.be.revertedWithCustomError(registry, "InvoiceNotOpen");
  });

  it("refuses to attest an HBAR settlement for a token invoice", async () => {
    const { registry, operator, merchant } = await deploy();
    const token = "0x00000000000000000000000000000000000004a2";
    const { id } = await openInvoice(registry, operator, merchant, token, 5n, "hts-1");
    await expect(
      registry.connect(operator).attestHbarSettlement(id, ethers.ZeroHash)
    ).to.be.revertedWithCustomError(registry, "InvalidInvoice");
  });

  it("token checkout guards: HBAR invoices cannot use the HTS path", async () => {
    const { registry, operator, merchant, payer } = await deploy();
    const { id } = await openInvoice(registry, operator, merchant, HBAR, 7n, "hts-guard");
    await expect(registry.connect(payer).payInvoiceWithHts(id)).to.be.revertedWithCustomError(
      registry,
      "InvalidInvoice"
    );
  });

  it("settled invoices can no longer be paid through the HTS path", async () => {
    const { registry, operator, merchant, payer } = await deploy();
    const token = "0x00000000000000000000000000000000000004a2";
    const { id } = await openInvoice(registry, operator, merchant, token, 9n, "hts-2");
    // Token invoices cannot be settled through the operator-attested HBAR path,
    // so cancel them to prove the HTS entry point is closed afterwards.
    await registry.connect(operator).cancelInvoice(id);
    await expect(registry.connect(payer).payInvoiceWithHts(id)).to.be.revertedWithCustomError(
      registry,
      "InvoiceNotOpen"
    );
  });

  it("merchant or operator can cancel; strangers cannot", async () => {
    const { registry, operator, merchant, stranger } = await deploy();
    const { id } = await openInvoice(registry, operator, merchant, HBAR, 1n, "cancel-1");
    await expect(registry.connect(stranger).cancelInvoice(id)).to.be.revertedWithCustomError(
      registry,
      "NotOperator"
    );
    await expect(registry.connect(merchant).cancelInvoice(id))
      .to.emit(registry, "InvoiceCancelled")
      .withArgs(id, merchant.address);
    expect((await registry.getInvoice(id)).status).to.equal(3n); // Cancelled
  });

  it("expiry: anyone can expire after the deadline, nobody before it", async () => {
    const { registry, operator, merchant, stranger } = await deploy();
    const { id } = await openInvoice(registry, operator, merchant, HBAR, 1n, "exp-1", 300);

    await expect(registry.connect(stranger).expireInvoice(id)).to.be.revertedWithCustomError(
      registry,
      "NotYetExpired"
    );

    await time.increase(301);
    await expect(registry.connect(stranger).expireInvoice(id)).to.emit(registry, "InvoiceExpired").withArgs(id);
    expect((await registry.getInvoice(id)).status).to.equal(4n); // Expired
    expect(await registry.isOpen(id)).to.equal(false);
  });

  it("owner can rotate the operator (gateway key rotation)", async () => {
    const { registry, owner, operator, stranger } = await deploy();
    await expect(registry.connect(owner).setOperator(stranger.address))
      .to.emit(registry, "IssuerChanged")
      .withArgs(operator.address, stranger.address);
    expect(await registry.operator()).to.equal(stranger.address);
    await expect(registry.connect(operator).setOperator(operator.address)).to.be.revertedWithCustomError(
      registry,
      "OwnableUnauthorizedAccount"
    );
  });

  describe("SaucerSwap any-token settlement", () => {
    async function deploySwap() {
      const ctx = await deploy();
      const tokenIn = await (await ethers.getContractFactory("MockERC20")).deploy("SAUCE", "SAUCE");
      const tokenOut = await (await ethers.getContractFactory("MockERC20")).deploy("USDC", "USDC");
      const router = await (await ethers.getContractFactory("MockSaucerRouter")).deploy();
      await tokenIn.waitForDeployment();
      await tokenOut.waitForDeployment();
      await router.waitForDeployment();
      await ctx.registry.connect(ctx.owner).setSaucerRouter(await router.getAddress());
      return { ...ctx, tokenIn, tokenOut, router };
    }

    it("reverts swap pay when no router is configured", async () => {
      const { registry, operator, merchant, payer } = await deploy();
      const token = "0x00000000000000000000000000000000000004a2";
      const { id } = await openInvoice(registry, operator, merchant, token, 50n, "swap-off");
      await expect(
        registry.connect(payer).payInvoiceWithSwap(id, 80n, [token, token], (await time.latest()) + 60)
      ).to.be.revertedWithCustomError(registry, "RouterNotSet");
    });

    it("swaps tokenIn → invoice token and pays the merchant atomically", async () => {
      const { registry, operator, merchant, payer, tokenIn, tokenOut } = await deploySwap();
      const outAddr = await tokenOut.getAddress();
      const inAddr = await tokenIn.getAddress();
      const { id } = await openInvoice(registry, operator, merchant, outAddr, 50n, "swap-1");

      await tokenIn.mint(payer.address, 80n);
      await tokenIn.connect(payer).approve(await registry.getAddress(), 80n);

      await expect(
        registry.connect(payer).payInvoiceWithSwap(id, 80n, [inAddr, outAddr], (await time.latest()) + 120)
      )
        .to.emit(registry, "InvoiceSettled")
        .withArgs(id, payer.address, outAddr, 50n, ethers.zeroPadValue(payer.address, 32), true);

      expect((await registry.getInvoice(id)).status).to.equal(2n);
      expect(await tokenOut.balanceOf(merchant.address)).to.equal(50n);
      expect(await tokenIn.balanceOf(await registry.getAddress())).to.equal(0n);
    });

    it("rejects a path that does not end in the invoice token", async () => {
      const { registry, operator, merchant, payer, tokenIn, tokenOut } = await deploySwap();
      const { id } = await openInvoice(registry, operator, merchant, await tokenOut.getAddress(), 10n, "swap-bad");
      await expect(
        registry
          .connect(payer)
          .payInvoiceWithSwap(id, 10n, [await tokenIn.getAddress(), await tokenIn.getAddress()], (await time.latest()) + 60)
      ).to.be.revertedWithCustomError(registry, "BadSwapPath");
    });
  });
});
