/**
 * Transfer 1 SOL to each fresh wallet from main devnet wallet
 */

const { Connection, PublicKey, Keypair, SystemProgram, Transaction } = require("@solana/web3.js");
const fs = require("fs");
const path = require("path");

const DEVNET_RPC = "https://devnet.helius-rpc.com/?api-key=f3417b56-61ad-4ba8-b0f9-3695ea859a58";

// Fresh wallets from previous test
const PLAYER1_PUBKEY = new PublicKey("BpbTuP8yy8MaLWn3jx1r9HoBdyEVVqHHkuzixyamRLXK");
const PLAYER2_PUBKEY = new PublicKey("hgPujTTeuWkp7NTyCi73KEouYdfWStNvYuVsXj9kLF6");

// Load CLI wallet (has actual SOL)
const homeDir = require("os").homedir();
const keypairPath = path.join(homeDir, ".config/solana/id.json");
const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf8"));
const mainWallet = Keypair.fromSecretKey(Uint8Array.from(keypairData));

const conn = new Connection(DEVNET_RPC, "confirmed");
const LAMPORTS_PER_SOL = 1e9;

async function transferSOL(recipient, amount, recipientName) {
  try {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: mainWallet.publicKey,
        toPubkey: recipient,
        lamports: amount,
      })
    );

    const sig = await conn.sendTransaction(tx, [mainWallet], { skipPreflight: false });
    await conn.confirmTransaction(sig, "confirmed");
    console.log(`✅ Transferred 1 SOL to ${recipientName}`);
    console.log(`   TX: https://explorer.solana.com/tx/${sig}?cluster=devnet\n`);
    return true;
  } catch (err) {
    console.log(`❌ Transfer failed: ${err.message}\n`);
    return false;
  }
}

async function run() {
  console.log("\n╔═══════════════════════════════════════════════════════════════════╗");
  console.log("║  💸 TRANSFERRING FUNDS FROM MAIN WALLET TO FRESH WALLETS         ║");
  console.log("╚═══════════════════════════════════════════════════════════════════╝\n");

  // Check main wallet balance
  const mainBalance = await conn.getBalance(mainWallet.publicKey);
  console.log(`📊 Main wallet: ${mainWallet.publicKey.toBase58()}`);
  console.log(`   Balance: ${(mainBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL\n`);

  if (mainBalance < 2.1 * LAMPORTS_PER_SOL) {
    console.log(`❌ Not enough SOL in main wallet (need 2.1 SOL, have ${(mainBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL)\n`);
    return;
  }

  console.log("💸 TRANSFERRING 1 SOL TO EACH WALLET...\n");

  // Transfer to player 1
  await transferSOL(PLAYER1_PUBKEY, 1 * LAMPORTS_PER_SOL, "Player1");

  // Transfer to player 2
  await transferSOL(PLAYER2_PUBKEY, 1 * LAMPORTS_PER_SOL, "Player2");

  // Verify final balances
  const p1Balance = await conn.getBalance(PLAYER1_PUBKEY);
  const p2Balance = await conn.getBalance(PLAYER2_PUBKEY);
  const mainBalanceFinal = await conn.getBalance(mainWallet.publicKey);

  console.log("✅ TRANSFER COMPLETE!\n");
  console.log("📊 FINAL BALANCES:");
  console.log(`   Main wallet:  ${(mainBalanceFinal / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`   Player1:      ${(p1Balance / LAMPORTS_PER_SOL).toFixed(4)} SOL ✅`);
  console.log(`   Player2:      ${(p2Balance / LAMPORTS_PER_SOL).toFixed(4)} SOL ✅\n`);

  console.log("🎮 Ready to run: node test_fresh_wallets.js\n");
}

run().catch(console.error);
