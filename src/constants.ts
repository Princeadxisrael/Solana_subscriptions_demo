import { PublicKey } from "@solana/web3.js";


export const PROGRAM_ID = new PublicKey(
  "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44"
);


export const SYSTEM_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");
export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);


export const DECIMALS = 6;
export const ONE_TOKEN = 1_000_000n; // 1.000000 units in base denomination

//instruction discriminators (see program/src/instructions.rs)
export enum Disc {
  InitSubscriptionAuthority  = 0,
  CreateFixedDelegation      = 1,
  CreateRecurringDelegation  = 2,
  RevokeDelegation           = 3,
  TransferFixed              = 4,
  TransferRecurring          = 5,
  CloseSubscriptionAuthority = 6,
  CreatePlan                 = 7,
  UpdatePlan                 = 8,
  DeletePlan                 = 9,
  TransferSubscription       = 10,
  Subscribe                  = 11,
  CancelSubscription         = 12,
  ResumeSubscription         = 13,
}


export const c = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  green:  "\x1b[32m",
  cyan:   "\x1b[36m",
  yellow: "\x1b[33m",
  red:    "\x1b[31m",
  blue:   "\x1b[34m",
  purple: "\x1b[35m",
};

export const log = {
  step:    (msg: string) => console.log(`\n  ${c.cyan}▶${c.reset}  ${msg}`),
  ok:      (msg: string) => console.log(`  ${c.green}✔${c.reset}  ${msg}`),
  info:    (msg: string) => console.log(`  ${c.blue}ℹ${c.reset}  ${msg}`),
  warn:    (msg: string) => console.log(`  ${c.yellow}⚠${c.reset}  ${msg}`),
  error:   (msg: string) => console.log(`  ${c.red}✖${c.reset}  ${msg}`),
  key:     (label: string, val: string) =>
    console.log(`     ${c.dim}${label.padEnd(22)}${c.reset}${c.purple}${val}${c.reset}`),
  balance: (label: string, val: bigint) =>
    console.log(`     ${c.dim}${label.padEnd(22)}${c.reset}${c.yellow}${formatTokens(val)} USDC${c.reset}`),
  section: (title: string) => {
    console.log(`\n${"─".repeat(60)}`);
    console.log(`  ${c.bold}${title}${c.reset}`);
    console.log("─".repeat(60));
  },
};

export function formatTokens(base: bigint): string {
  const whole = base / ONE_TOKEN;
  const frac  = base % ONE_TOKEN;
  return `${whole}.${frac.toString().padStart(6, "0")}`;
}
