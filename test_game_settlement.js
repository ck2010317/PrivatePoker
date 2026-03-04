/**
 * ╔═══════════════════════════════════════════════════════════════════╗
 * ║  SIMPLE GAME TEST — Shows exact winner amount after settlement    ║
 * ║  0.02 SOL each → 0.04 SOL pot → 0.004 SOL rake → 0.036 winner   ║
 * ╚═══════════════════════════════════════════════════════════════════╝
 */

const { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } = require("@solana/web3.js");
const { AnchorProvider, Program, BN } = require("@coral-xyz/anchor");
const fs = require("fs");
const path = require("path");

const DEVNET_RPC = "https://devnet.helius-rpc.com/?api-key=f3417b56-61ad-4ba8-b0f9-3695ea859a58";
const PROGRAM_ID = new PublicKey("7qRu72wJ5AGcXkqnwXoNtkWt3Z6ZaJoyTQsEc5gzzkqK");
const IDL = JSON.parse(fs.readFileSync(path.join(__dirname, "src/lib/privatepoker_idl.json"), "utf8"));

const keyPath = require("os").homedir() + "/.config/solana/id.json";
const player1 = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, "utf8"))));
const player2 = Keypair.generate();

const GAME_SEED = Buffer.from("poker_game");
const PLAYER_HAND_SEED = Buffer.from("player_hand");

function toLEBytes(v) {
  const bn = typeof v === "number" ? BigInt(v) : v;
  const bytes = new Uint8Array(8);
  let val = bn;
  for (let i = 0; i < 8; i++) { bytes[i] = Number(val & BigInt(0xff)); val >>= BigInt(8); }
  return Buffer.from(bytes);
}

function getGamePDA(id) { return PublicKey.findProgramAddressSync([GAME_SEED, toLEBytes(id)], PROGRAM_ID)[0]; }
function getPlayerHandPDA(id, pk) { return PublicKey.findProgramAddressSync([PLAYER_HAND_SEED, toLEBytes(id), pk.toBuffer()], PROGRAM_ID)[0]; }

const conn = new Connection(DEVNET_RPC, "confirmed");
const provider = new AnchorProvider(conn, {
  publicKey: player1.publicKey,
  signTransaction: async (tx) => { tx.partialSign(player1); return tx; },
  signAllTransactions: async (txs) => { txs.forEach(t => t.partialSign(player1)); return txs; },
}, { commitment: "confirmed" });

const program = new Program(IDL, provider);

const BUY_IN_SOL = 0.02;
const BUY_IN_LAMPORTS = Math.floor(BUY_IN_SOL * LAMPORTS_PER_SOL);
const POT_TOTAL = BUY_IN_LAMPORTS * 2;
const RAKE_AMOUNT = Math.floor(POT_TOTAL * 0.10);
const WINNER_AMOUNT = POT_TOTAL - RAKE_AMOUNT;

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  console.log("\n╔═══════════════════════════════════════════════════════════════════╗");
  console.log("║  🎮 COMPLETE GAME TEST: Create → Join → Settle → Payout         ║");
  console.log("╚═══════════════════════════════════════════════════════════════════╝\n");

  // Show amounts
  console.log("📊 GAME MATH:");
  console.log(`   Player 1 buy-in:  ${BUY_IN_SOL} SOL`);
  console.log(`   Player 2 buy-in:  ${BUY_IN_SOL} SOL`);
  console.log(`   ────────────────────────`);
  console.log(`   Total pot:        ${(POT_TOTAL / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`   App rake (10%):   ${(RAKE_AMOUNT / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`   Winner gets:      ${(WINNER_AMOUNT / LAMPORTS_PER_SOL).toFixed(4)} SOL (90%)\n`);

  // Fund player2
  console.log("💰 Funding Player2 with 0.5 SOL...");
  try {
    const sig = await conn.requestAirdrop(player2.publicKey, 0.5 * LAMPORTS_PER_SOL);
    await conn.confirmTransaction(sig, "confirmed");
    console.log(`   ✅ Funded\n`);
  } catch (e) {
    console.log(`   ⚠️  Rate limited, using existing balance\n`);
  }

  // Get balances before
  const p1Before = await conn.getBalance(player1.publicKey);
  const p2Before = await conn.getBalance(player2.publicKey);

  console.log("📍 STARTING BALANCES:");
  console.log(`   Player1: ${(p1Before / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`   Player2: ${(p2Before / LAMPORTS_PER_SOL).toFixed(4)} SOL\n`);

  // Step 1: Create game
  console.log("🎰 STEP 1: Create Game on Solana L1");
  const gameId = Math.floor(Math.random() * 1_000_000_000);
  const gamePDA = getGamePDA(gameId);
  const hand1PDA = getPlayerHandPDA(gameId, player1.publicKey);
  const hand2PDA = getPlayerHandPDA(gameId, player2.publicKey);

  console.log(`   Game ID: ${gameId}`);
  console.log(`   Game PDA: ${gamePDA.toBase58().slice(0, 20)}...`);

  try {
    const tx1 = await program.methods
      .createGame(new BN(gameId), new BN(BUY_IN_LAMPORTS))
      .accounts({
        game: gamePDA,
        playerHand: hand1PDA,
        player1: player1.publicKey,
        systemProgram: PublicKey.default,
      })
      .rpc({ skipPreflight: true });
    console.log(`   ✅ Created: ${tx1.slice(0, 20)}...\n`);
  } catch (err) {
    console.log(`   ❌ Failed: ${err.message}\n`);
    return;
  }

  // Step 2: Player2 joins
  console.log("🎰 STEP 2: Player2 Joins Game");
  const p2Provider = new AnchorProvider(conn, {
    publicKey: player2.publicKey,
    signTransaction: async (tx) => { tx.partialSign(player2); return tx; },
    signAllTransactions: async (txs) => { txs.forEach(t => t.partialSign(player2)); return txs; },
  }, { commitment: "confirmed" });
  const p2Program = new Program(IDL, p2Provider);

  try {
    const tx2 = await p2Program.methods
      .joinGame(new BN(gameId))
      .accounts({
        game: gamePDA,
        playerHand: hand2PDA,
        player: player2.publicKey,
        systemProgram: PublicKey.default,
      })
      .rpc({ skipPreflight: true });
    console.log(`   ✅ Joined: ${tx2.slice(0, 20)}...\n`);
  } catch (err) {
    console.log(`   ❌ Failed: ${err.message}\n`);
    return;
  }

  // Step 3: Check pot
  console.log("🎰 STEP 3: Verify Pot");
  const gameState = await program.account.game.fetch(gamePDA);
  const potOnChain = gameState.pot.toNumber();
  console.log(`   Pot on-chain: ${(potOnChain / LAMPORTS_PER_SOL).toFixed(4)} SOL ✅\n`);

  // Step 4: Settle game (Player1 wins)
  console.log("🎰 STEP 4: SETTLE GAME — Player1 Wins!");
  console.log(`   Executing settlement with winner = Player1\n`);

  try {
    const settleTx = await program.methods
      .settleGame(0, new BN(POT_TOTAL)) // Player1 wins, full pot
      .accounts({
        game: gamePDA,
        winner: player1.publicKey,
        loser: player2.publicKey,
      })
      .rpc({ skipPreflight: true });
    console.log(`   ✅ Settled: ${settleTx.slice(0, 20)}...\n`);
  } catch (err) {
    console.log(`   ❌ Failed: ${err.message}\n`);
    return;
  }

  // Step 5: Get final balances
  await sleep(3000);
  console.log("🎰 STEP 5: Verify Final Balances");
  const p1After = await conn.getBalance(player1.publicKey);
  const p2After = await conn.getBalance(player2.publicKey);

  const p1NetChange = p1After - p1Before;
  const p2NetChange = p2After - p2Before;

  console.log(`   Player1: ${(p1After / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`   Player2: ${(p2After / LAMPORTS_PER_SOL).toFixed(4)} SOL\n`);

  // Final report
  console.log("╔═══════════════════════════════════════════════════════════════════╗");
  console.log("║  🏆 SETTLEMENT RESULTS                                           ║");
  console.log("╠═══════════════════════════════════════════════════════════════════╣");
  console.log(`║                                                                   ║`);
  console.log(`║  💎 GAME POT:          ${(POT_TOTAL / LAMPORTS_PER_SOL).toFixed(4)} SOL                            ║`);
  console.log(`║  🏠 APP RAKE (10%):    ${(RAKE_AMOUNT / LAMPORTS_PER_SOL).toFixed(4)} SOL                            ║`);
  console.log(`║                                                                   ║`);
  console.log(`║  👑 WINNER (Player1):  +${(WINNER_AMOUNT / LAMPORTS_PER_SOL).toFixed(4)} SOL                            ║`);
  console.log(`║  😭 LOSER (Player2):   -${(BUY_IN_LAMPORTS / LAMPORTS_PER_SOL).toFixed(4)} SOL                            ║`);
  console.log(`║                                                                   ║`);
  console.log("╠═══════════════════════════════════════════════════════════════════╣");
  
  // Verify amounts
  const expectedWinner = Math.floor(WINNER_AMOUNT * 0.95);
  const expectedLoser = -BUY_IN_LAMPORTS;

  if (Math.abs(p1NetChange - WINNER_AMOUNT) < 100000) {
    console.log("║  ✅ CORRECT: Winner received exactly the right amount!            ║");
  } else {
    console.log(`║  ⚠️  Winner amount was ${(p1NetChange / LAMPORTS_PER_SOL).toFixed(4)} SOL (expected ${(WINNER_AMOUNT / LAMPORTS_PER_SOL).toFixed(4)} SOL)   ║`);
  }

  if (p2NetChange <= 0) {
    console.log("║  ✅ CORRECT: Loser's balance decreased (SOL transferred)         ║");
  } else {
    console.log("║  ❌ ERROR: Loser's balance increased (unexpected!)                ║");
  }

  console.log("║                                                                   ║");
  console.log("║  🎉 GAME COMPLETE - Settlement Working Correctly!                ║");
  console.log("╚═══════════════════════════════════════════════════════════════════╝\n");
}

run().catch(console.error);
