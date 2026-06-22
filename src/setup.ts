import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import { c, log, ONE_TOKEN, TOKEN_PROGRAM_ID } from "./constants";

const STATE_FILE = path.join(__dirname, "..", ".demo-state.json");


// Shared context passed between demos 
export interface DemoContext {
  connection: Connection;
  alice:      Keypair;   // delegator / subscriber
  bob:        Keypair;   // delegatee / beneficiary
  merchant:   Keypair;   // plan owner / puller
  mint:       PublicKey; // mock USDC (6 decimals)
  aliceAta:   PublicKey;
  bobAta:     PublicKey;
  merchantAta: PublicKey;
}

//  Deterministic keypairs (same addresses on every run) 
// Using fixed 32-byte seeds so PDA addresses are predictable across runs.
function makeKeypair(seed: string): Keypair {
  const seedBytes = Buffer.alloc(32);
  Buffer.from(seed).copy(seedBytes);
  return Keypair.fromSeed(seedBytes);
}

// Main setup function
export async function setup(): Promise<DemoContext> {
  log.section("Setup — wallets, mint, ATAs");

  // Connection 
  const connection = new Connection("http://localhost:8899", "confirmed");

  // Verify validator is running
  try {
    const slot = await connection.getSlot();
    log.ok(`Connected to local validator (slot ${slot})`);
  } catch {
    console.error(`\n${c.red}✖  Cannot connect to http://localhost:8899${c.reset}`);
    console.error(`   Start the validator first:\n`);
    console.error(`   ${c.cyan}cd ../subscriptions && just webapp-run${c.reset}\n`);
    process.exit(1);
  }


  const alice    = makeKeypair("demo-alice-000000000000000000000000");
  const bob      = makeKeypair("demo-bob-0000000000000000000000000000");
  const merchant = makeKeypair("demo-merchant-00000000000000000000000");

  log.step("Airdropping 2 SOL to Alice, Bob, Merchant");
  await airdropIfNeeded(connection, alice.publicKey,    2 * LAMPORTS_PER_SOL);
  await airdropIfNeeded(connection, bob.publicKey,      2 * LAMPORTS_PER_SOL);
  await airdropIfNeeded(connection, merchant.publicKey, 2 * LAMPORTS_PER_SOL);

  log.key("Alice    (delegator)", alice.publicKey.toBase58());
  log.key("Bob      (delegatee)", bob.publicKey.toBase58());
  log.key("Merchant (plan owner)", merchant.publicKey.toBase58());

  // Mock USDC mint (Alice is mint authority, 6 decimals)
  log.step("Creating mock USDC mint");
  const mint = await createMint(
    connection,
    alice,          // payer
    alice.publicKey,// mint authority
    null,           // freeze authority
    6,              // decimals (matches real USDC)
    undefined,
    undefined,
    TOKEN_PROGRAM_ID
  );
  log.key("Mint address", mint.toBase58());


  log.step("Creating ATAs");
  const aliceAtaInfo    = await getOrCreateAssociatedTokenAccount(connection, alice, mint, alice.publicKey);
  const bobAtaInfo      = await getOrCreateAssociatedTokenAccount(connection, alice, mint, bob.publicKey);
  const merchantAtaInfo = await getOrCreateAssociatedTokenAccount(connection, alice, mint, merchant.publicKey);

  // Mint 10,000 USDC to Alice 
  log.step("Minting 10,000 USDC to Alice");
  await mintTo(
    connection,
    alice,
    mint,
    aliceAtaInfo.address,
    alice,           // mint authority
    10_000n * ONE_TOKEN
  );

  const aliceBalance = await getTokenBalance(connection, aliceAtaInfo.address);
  log.balance("Alice balance", aliceBalance);
  log.balance("Bob balance  ", 0n);


  // Persist run metadata so `npm run verify` can find this mint later
  // without the user having to copy-paste an address by hand.
  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify(
      {
        mint: mint.toBase58(),
        alice: alice.publicKey.toBase58(),
        bob: bob.publicKey.toBase58(),
        merchant: merchant.publicKey.toBase58(),
        timestamp: new Date().toISOString(),
      },
      null,
      2
    )
  );

  return {
    connection,
    alice,
    bob,
    merchant,
    mint,
    aliceAta:    aliceAtaInfo.address,
    bobAta:      bobAtaInfo.address,
    merchantAta: merchantAtaInfo.address,
  };
}

// Helpers
/** Airdrop SOL only if the account balance is below the requested amount. */
export async function airdropIfNeeded(
  connection: Connection,
  address: PublicKey,
  lamports: number
): Promise<void> {
  const balance = await connection.getBalance(address);
  if (balance < lamports / 2) {
    const sig = await connection.requestAirdrop(address, lamports);
    await connection.confirmTransaction(sig, "confirmed");
  }
}

/** Read the token balance of an ATA as a bigint (base units). */
export async function getTokenBalance(
  connection: Connection,
  ata: PublicKey
): Promise<bigint> {
  try {
    const info = await getAccount(connection, ata);
    return info.amount;
  } catch {
    return 0n;
  }
}

/** Send a single-instruction transaction and return the signature. */
export async function sendTx(
  connection: Connection,
  instruction: import("@solana/web3.js").TransactionInstruction,
  signers: Keypair[]
): Promise<string> {
  const tx = new Transaction().add(instruction);
  return sendAndConfirmTransaction(connection, tx, signers, {
    commitment: "confirmed",
  });
}

/** Print balances for all parties. */
export async function printBalances(
  connection: Connection,
  ctx: Pick<DemoContext, "aliceAta" | "bobAta" | "merchantAta">
): Promise<void> {
  const [alice, bob, merc] = await Promise.all([
    getTokenBalance(connection, ctx.aliceAta),
    getTokenBalance(connection, ctx.bobAta),
    getTokenBalance(connection, ctx.merchantAta),
  ]);
  log.balance("Alice    balance", alice);
  log.balance("Bob      balance", bob);
  log.balance("Merchant balance", merc);
}
