/**
 * Verification script — independently confirms the demo's on-chain state
 * by fetching raw account bytes and decoding them field-by-field, rather
 * than trusting the demo script's own console.log output.
 *
 * Run after `npm run demo`:
 *   npm run verify
 *
 * Reads .demo-state.json (written by setup.ts) to find the mint address
 * used in the last run, then re-derives every PDA deterministically and
 * fetches + decodes each account directly from the validator.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { c } from "./constants";
import {
  getSubscriptionAuthorityPDA,
  getPlanPDA,
  getSubscriptionPDA,
  getATA,
} from "./pdas";
import {
  decodeSubscriptionAuthority,
  decodePlan,
  decodeSubscriptionDelegation,
  ACCOUNT_DISCRIMINATOR_LABELS,
} from "./decode";

const STATE_FILE = path.join(__dirname, "..", ".demo-state.json");
const PLAN_ID = 1001n; // must match the planId used in 03-plan.ts

function section(title: string) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${c.bold}${title}${c.reset}`);
  console.log("─".repeat(60));
}

function field(label: string, value: string) {
  console.log(`     ${c.dim}${label.padEnd(28)}${c.reset}${c.purple}${value}${c.reset}`);
}

async function main() {
  if (!fs.existsSync(STATE_FILE)) {
    console.error(
      `${c.red}No .demo-state.json found. Run "npm run demo" at least once first.${c.reset}`
    );
    process.exit(1);
  }

  const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  const mint     = new PublicKey(state.mint);
  const alice    = new PublicKey(state.alice);
  const bob      = new PublicKey(state.bob);
  const merchant = new PublicKey(state.merchant);

  console.log(`\n  ${c.bold}${c.purple}On-Chain State Verification${c.reset}`);
  console.log(`  ${c.dim}Decoding raw account bytes directly — not trusting demo output${c.reset}`);
  console.log(`  ${c.dim}Last demo run: ${state.timestamp}${c.reset}`);

  const connection = new Connection("http://localhost:8899", "confirmed");

  //  Subscription Authority 
  section("1. Subscription Authority (Alice's single delegate)");
  const [saPDA] = getSubscriptionAuthorityPDA(alice, mint);
  field("Address", saPDA.toBase58());

  const saInfo = await connection.getAccountInfo(saPDA);
  if (!saInfo) {
    console.log(`     ${c.red}Not found — was it closed, or has the demo run yet?${c.reset}`);
  } else {
    const sa = decodeSubscriptionAuthority(saInfo.data);
    field("Raw account size", `${saInfo.data.length} bytes (expected 106)`);
    field("Discriminator", `${sa.discriminator} (${ACCOUNT_DISCRIMINATOR_LABELS[sa.discriminator]})`);
    field("user", sa.user.toBase58());
    field("token_mint", sa.tokenMint.toBase58());
    field("payer", sa.payer.toBase58());
    field("bump", String(sa.bump));
    field("init_id", String(sa.initId));
    console.log(
      `     ${c.green}user matches Alice: ${sa.user.equals(alice)}${c.reset}`
    );
    console.log(
      `     ${c.green}token_mint matches demo mint: ${sa.tokenMint.equals(mint)}${c.reset}`
    );
  }

  // Plan account 
  section("2. Plan (merchant's published subscription terms)");
  const [planPDA] = getPlanPDA(merchant, PLAN_ID);
  field("Address", planPDA.toBase58());

  const planInfo = await connection.getAccountInfo(planPDA);
  if (!planInfo) {
    console.log(`     ${c.red}Not found — was it deleted, or has Demo 3 run yet?${c.reset}`);
  } else {
    const plan = decodePlan(planInfo.data);
    field("Raw account size", `${planInfo.data.length} bytes (expected 491)`);
    field("owner", plan.owner.toBase58());
    field("status", plan.status);
    field("plan_id", String(plan.planId));
    field("mint", plan.mint.toBase58());
    field("terms.amount", `${plan.amount} base units (${Number(plan.amount) / 1e6} USDC)`);
    field("terms.period_hours", String(plan.periodHours));
    field("terms.created_at", `${plan.createdAt}  (${new Date(Number(plan.createdAt) * 1000).toISOString()})`);
    field("end_ts", plan.endTs === 0n ? "0 (no expiry)" : String(plan.endTs));
    const activeDest = plan.destinations.filter((d) => !d.equals(PublicKey.default));
    const activePull = plan.pullers.filter((p) => !p.equals(PublicKey.default));
    field("destinations (non-zero)", activeDest.length === 0 ? "none (any destination allowed)" : activeDest.map((d) => d.toBase58()).join(", "));
    field("pullers (non-zero)", activePull.length === 0 ? "none (owner-only)" : activePull.map((p) => p.toBase58()).join(", "));
    console.log(
      `     ${c.green} terms.amount matches 10 USDC: ${plan.amount === 10_000_000n}${c.reset}`
    );
  }

  //SubscriptionDelegation (Alice's subscription to the plan) 
  section("3. SubscriptionDelegation (Alice's subscription state)");
  const [subPDA] = getSubscriptionPDA(planPDA, alice);
  field("Address", subPDA.toBase58());

  const subInfo = await connection.getAccountInfo(subPDA);
  if (!subInfo) {
    console.log(`     ${c.red}Not found — has Alice subscribed yet, or was it revoked?${c.reset}`);
  } else {
    const sub = decodeSubscriptionDelegation(subInfo.data);
    field("Raw account size", `${subInfo.data.length} bytes (expected 155)`);
    field("header.delegator (subscriber)", sub.header.delegator.toBase58());
    field("header.delegatee (plan PDA)", sub.header.delegatee.toBase58());
    field("header.init_id", String(sub.header.initId));
    field("terms.amount (snapshot)", `${sub.termsAmount} base units`);
    field("terms.period_hours (snapshot)", String(sub.termsPeriodHours));
    field("terms.created_at (snapshot)", String(sub.termsCreatedAt));
    field("amount_pulled_in_period", `${sub.amountPulledInPeriod} base units`);
    field(
      "current_period_start_ts",
      `${sub.currentPeriodStartTs}  (${new Date(Number(sub.currentPeriodStartTs) * 1000).toISOString()})`
    );
    field(
      "expires_at_ts",
      sub.expiresAtTs === 0n
        ? "0 — ACTIVE (not cancelled)"
        : `${sub.expiresAtTs}  (cancelled, expires ${new Date(Number(sub.expiresAtTs) * 1000).toISOString()})`
    );
    console.log(
      `     ${c.green}✔ delegator matches Alice: ${sub.header.delegator.equals(alice)}${c.reset}`
    );
    console.log(
      `     ${c.green}✔ delegatee matches plan PDA: ${sub.header.delegatee.equals(planPDA)}${c.reset}`
    );

    // Ghost-account check, performed manually here exactly as the program does it.
    if (planInfo) {
      const plan = decodePlan(planInfo.data);
      const termsMatch =
        sub.termsAmount === plan.amount &&
        sub.termsPeriodHours === plan.periodHours &&
        sub.termsCreatedAt === plan.createdAt;
      console.log(
        `     ${termsMatch ? c.green + "✔" : c.red + "✘"} snapshot terms match live plan terms: ${termsMatch}${c.reset}`
      );
    }
  }

  // Token balances (ground truth, independent of demo's own prints)
  section("4. Token balances (read directly from SPL Token accounts)");
  const aliceAta    = getATA(alice, mint);
  const bobAta      = getATA(bob, mint);
  const merchantAta = getATA(merchant, mint);

  for (const [label, ata] of [
    ["Alice", aliceAta],
    ["Bob", bobAta],
    ["Merchant", merchantAta],
  ] as const) {
    const info = await connection.getAccountInfo(ata);
    if (!info) {
      field(label, "ATA not found");
      continue;
    }
    // SPL token account layout: amount is a u64 at byte offset 64
    const amount = info.data.readBigUInt64LE(64);
    field(label, `${Number(amount) / 1e6} USDC  (raw: ${amount})`);
  }


  section("5. Manual inspection tools");
  console.log(`
  ${c.bold}Inspect any transaction signature:${c.reset}
    solana confirm -v <SIGNATURE> --url http://localhost:8899

  ${c.bold}Dump raw account bytes via CLI:${c.reset}
    solana account ${saPDA.toBase58()} --url http://localhost:8899 --output json

  ${c.bold}Browse with Solana Explorer (point it at your local RPC):${c.reset}
    https://explorer.solana.com/?cluster=custom&customUrl=http://localhost:8899

  ${c.bold}Surfpool Studio${c.reset} (if you're running Surfpool, not solana-test-validator):
    Check the terminal output from when Surfpool started — it prints a
    Studio URL with a live transaction/account browser for your local Surfnet.
`);
}

main().catch((err) => {
  console.error(`\n${c.red}${c.bold}Verification failed:${c.reset}`, err.message ?? err);
  process.exit(1);
});