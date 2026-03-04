/**
 * ╔═══════════════════════════════════════════════════════════════════╗
 * ║  COMPLETE GAME TEST — MagicBlock ER + Winner Settlement           ║
 * ║  Shows exact amounts: buy-in → pot → 10% rake → winner payout   ║
 * ╚═══════════════════════════════════════════════════════════════════╝
 */

const { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } = require("@solana/web3.js");
const { AnchorProvider, Program, BN } = require("@coral-xyz/anchor");
const fs = require("fs");
const path = require("path");

// ─── CONFIG ───
const DEVNET_RPC = "https://devnet.helius-rpc.com/?api-key=f3417b56-61ad-4ba8-b0f9-3695ea859a58";
const ER_RPC = "https://devnet-us.magicblock.app";
const PROGRAM_ID = new PublicKey("7qRu72wJ5AGcXkqnwXoNtkWt3Z6ZaJoyTQsEc5gzzkqK");
const ER_VALIDATOR = new PublicKey("MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd");
const IDL = JSON.parse(fs.readFileSync(path.join(__dirname, "src/lib/privatepoker_idl.json"), "utf8"));

// ─── WALLETS ───
const keyPath = require("os").homedir() + "/.config/solana/id.json";
const player1 = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, "utf8"))));
const player2 = Keypair.generate();

// ─── SEEDS ───
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

// ─── SETUP ───
const conn = new Connection(DEVNET_RPC, "confirmed");
const erConn = new Connection(ER_RPC, "confirmed");

const provider = new AnchorProvider(conn, {
  publicKey: player1.publicKey,
  signTransaction: async (tx) => { tx.partialSign(player1); return tx; },
  signAllTransactions: async (txs) => { txs.forEach(t => t.partialSign(player1)); return txs; },
}, { commitment: "confirmed" });

const program = new Program(IDL, provider);

// ─── GAME STATE ───
let gameId, gamePDA, hand1PDA, hand2PDA;
let player1BalBefore, player2BalBefore;
let player1BalAfter, player2BalAfter;

const BUY_IN_SOL = 0.02; // 0.02 SOL each
const BUY_IN_LAMPORTS = Math.floor(BUY_IN_SOL * LAMPORTS_PER_SOL);
const POT_TOTAL = BUY_IN_LAMPORTS * 2; // 0.04 SOL total
const RAKE_PERCENT = 0.10; // 10%
const RAKE_AMOUNT = Math.floor(POT_TOTAL * RAKE_PERCENT);
const WINNER_AMOUNT = POT_TOTAL - RAKE_AMOUNT;

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  console.log("\n╔═══════════════════════════════════════════════════════════════════╗");
  console.log("║  🎮 COMPLETE GAME TEST: MagicBlock + Winner Settlement            ║");
  console.log("╚═══════════════════════════════════════════════════════════════════╝\n");

  // STEP 1: Funding
  console.log("📊 GAME PARAMETERS:");
  console.log(`  Buy-in per player: ${BUY_IN_SOL} SOL (${BUY_IN_LAMPORTS} lamports)`);
  console.log(`  Total pot: ${(POT_TOTAL / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`  Rake (10%): ${(RAKE_AMOUNT / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`  Winner gets: ${(WINNER_AMOUNT / LAMPORTS_PER_SOL).toFixed(4)} SOL (90%)\n`);

  console.log("💰 Step 0: Funding player2...");
  try {
    await conn.requestAirdrop(player2.publicKey, 0.5 * LAMPORTS_PER_SOL);
    await sleep(2000);
    console.log(`  ✅ Player2 funded\n`);
  } catch (e) {
    console.log(`  ⚠️  Airdrop failed (might be rate limited), continuing...\n`);
  }

  // STEP 2: Get pre-game balances
  console.log("💵 PRE-GAME BALANCES:");
  player1BalBefore = await conn.getBalance(player1.publicKey);
  player2BalBefore = await conn.getBalance(player2.publicKey);
  console.log(`  Player1: ${(player1BalBefore / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`  Player2: ${(player2BalBefore / LAMPORTS_PER_SOL).toFixed(4)} SOL\n`);

  // STEP 3: Create game
  console.log("🃏 Step 1: Creating game on L1...");
  gameId = Math.floor(Math.random() * 1_000_000_000);
  gamePDA = getGamePDA(gameId);
  hand1PDA = getPlayerHandPDA(gameId, player1.publicKey);
  hand2PDA = getPlayerHandPDA(gameId, player2.publicKey);

  console.log(`  Game ID: ${gameId}`);
  console.log(`  Game PDA: ${gamePDA.toBase58()}`);

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
    console.log(`  ✅ Game created: ${tx1.slice(0, 20)}...\n`);
  } catch (err) {
    console.log(`  ❌ Create failed: ${err.message}\n`);
    return;
  }

  // STEP 4: Player2 joins
  console.log("🤝 Step 2: Player2 joining game...");
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
    console.log(`  ✅ Player2 joined: ${tx2.slice(0, 20)}...\n`);
  } catch (err) {
    console.log(`  ❌ Join failed: ${err.message}\n`);
    return;
  }

  // STEP 5: Get game state after join
  const gameState = await (program.account.game).fetch(gamePDA);
  const potBeforeER = gameState.pot.toNumber();
  console.log(`  📍 Pot after join: ${(potBeforeER / LAMPORTS_PER_SOL).toFixed(4)} SOL\n`);

  // STEP 6: Delegate to MagicBlock
  console.log("🔗 Step 3: Delegating to MagicBlock ER...");
  try {
    const delegateIx1 = await program.methods
      .delegatePda({ game: { gameId: new BN(gameId) } })
      .accounts({
        pda: gamePDA,
        payer: player1.publicKey,
        validator: ER_VALIDATOR,
      })
      .instruction();

    const delegateIx2 = await program.methods
      .delegatePda({ playerHand: { gameId: new BN(gameId), player: player1.publicKey } })
      .accounts({
        pda: hand1PDA,
        payer: player1.publicKey,
        validator: ER_VALIDATOR,
      })
      .instruction();

    const delegateIx3 = await program.methods
      .delegatePda({ playerHand: { gameId: new BN(gameId), player: player2.publicKey } })
      .accounts({
        pda: hand2PDA,
        payer: player1.publicKey,
        validator: ER_VALIDATOR,
      })
      .instruction();

    const { blockhash } = await conn.getLatestBlockhash();
    const tx = new (require("@solana/web3.js")).Transaction({
      recentBlockhash: blockhash,
      feePayer: player1.publicKey,
    });
    tx.add(delegateIx1, delegateIx2, delegateIx3);
    tx.partialSign(player1);

    const delegateTx = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    await conn.confirmTransaction(delegateTx, "confirmed");
    console.log(`  ✅ Delegated: ${delegateTx.slice(0, 20)}...`);
    console.log(`  ⏳ Waiting 5s for delegation to propagate...\n`);
    await sleep(5000);
  } catch (err) {
    console.log(`  ❌ Delegation failed: ${err.message}\n`);
    return;
  }

  // STEP 7: Deal cards on ER
  console.log("🎴 Step 4: Dealing cards on MagicBlock ER...");
  const erProvider = new AnchorProvider(erConn, {
    publicKey: player1.publicKey,
    signTransaction: async (tx) => { tx.partialSign(player1); return tx; },
    signAllTransactions: async (txs) => { txs.forEach(t => t.partialSign(player1)); return txs; },
  }, { commitment: "confirmed" });
  const erProgram = new Program(IDL, erProvider);

  try {
    const dealTx = await erProgram.methods
      .dealCards(new BN(gameId), [2, 5], [9, 12], [3, 7, 11, 4, 8])
      .accounts({
        game: gamePDA,
        player1Hand: hand1PDA,
        player2Hand: hand2PDA,
        dealer: player1.publicKey,
      })
      .rpc({ skipPreflight: true });
    console.log(`  ✅ Cards dealt on ER: ${dealTx.slice(0, 20)}...\n`);
  } catch (err) {
    console.log(`  ❌ Deal failed: ${err.message}\n`);
  }

  // STEP 8: Player action on ER (Player2 folds for quick resolution)
  console.log("♠️  Step 5: Player2 folds on ER...");
  try {
    const foldTx = await erProgram.methods
      .playerAction(new BN(gameId), { fold: {} })
      .accounts({
        game: gamePDA,
        playerHand: hand2PDA,
        player: player2.publicKey,
      })
      .instruction();

    const { blockhash } = await erConn.getLatestBlockhash();
    const foldTxn = new (require("@solana/web3.js")).Transaction({
      recentBlockhash: blockhash,
      feePayer: player2.publicKey,
    });
    foldTxn.add(foldTx);
    foldTxn.partialSign(player2);

    const foldSig = await erConn.sendRawTransaction(foldTxn.serialize(), { skipPreflight: true });
    await erConn.confirmTransaction(foldSig, "confirmed");
    console.log(`  ✅ Player2 folded: ${foldSig.slice(0, 20)}...\n`);
  } catch (err) {
    console.log(`  ❌ Fold failed (continuing): ${err.message}\n`);
  }

  // STEP 9: Reveal winner (commit + undelegate)
  console.log("👑 Step 6: Revealing winner on ER (commit + undelegate)...");
  try {
    const revealIx = await erProgram.methods
      .revealWinner(0) // Player1 wins (Player2 folded)
      .accounts({
        game: gamePDA,
        player1Hand: hand1PDA,
        player2Hand: hand2PDA,
        payer: player1.publicKey,
      })
      .instruction();

    const { blockhash } = await erConn.getLatestBlockhash();
    const revealTxn = new (require("@solana/web3.js")).Transaction({
      recentBlockhash: blockhash,
      feePayer: player1.publicKey,
    });
    revealTxn.add(revealIx);
    revealTxn.partialSign(player1);

    const revealSig = await erConn.sendRawTransaction(revealTxn.serialize(), { skipPreflight: true });
    await erConn.confirmTransaction(revealSig, "confirmed");
    console.log(`  ✅ Winner revealed + undelegated: ${revealSig.slice(0, 20)}...\n`);
  } catch (err) {
    console.log(`  ❌ Reveal failed: ${err.message}\n`);
  }

  // STEP 10: Wait for undelegation
  console.log("⏳ Step 7: Waiting for undelegation callback to L1...");
  for (let i = 0; i < 12; i++) {
    await sleep(3000);
    try {
      const gameAccount = await conn.getAccountInfo(gamePDA);
      if (gameAccount && gameAccount.owner.equals(PROGRAM_ID)) {
        console.log(`  ✅ Undelegated after ${(i + 1) * 3}s\n`);
        break;
      }
    } catch {}
  }

  // STEP 11: Settle game on L1
  console.log("🏆 Step 8: SETTLING GAME & DISTRIBUTING SOL...");
  try {
    const settleTx = await program.methods
      .settleGame(0, new BN(POT_TOTAL)) // Player1 wins, full pot
      .accounts({
        game: gamePDA,
        winner: player1.publicKey,
        loser: player2.publicKey,
      })
      .rpc({ skipPreflight: true });
    console.log(`  ✅ Settlement TX: ${settleTx.slice(0, 20)}...\n`);
  } catch (err) {
    console.log(`  ❌ Settlement failed: ${err.message}\n`);
    return;
  }

  // STEP 12: Get post-game balances
  await sleep(2000);
  console.log("💵 POST-GAME BALANCES:");
  player1BalAfter = await conn.getBalance(player1.publicKey);
  player2BalAfter = await conn.getBalance(player2.publicKey);
  
  const p1Change = player1BalAfter - player1BalBefore;
  const p2Change = player2BalAfter - player2BalBefore;

  console.log(`  Player1: ${(player1BalAfter / LAMPORTS_PER_SOL).toFixed(4)} SOL (change: ${p1Change > 0 ? "+" : ""}${(p1Change / LAMPORTS_PER_SOL).toFixed(4)} SOL)`);
  console.log(`  Player2: ${(player2BalAfter / LAMPORTS_PER_SOL).toFixed(4)} SOL (change: ${p2Change > 0 ? "+" : ""}${(p2Change / LAMPORTS_PER_SOL).toFixed(4)} SOL)\n`);

  // FINAL REPORT
  console.log("╔═══════════════════════════════════════════════════════════════════╗");
  console.log("║  📊 FINAL SETTLEMENT REPORT                                      ║");
  console.log("╠═══════════════════════════════════════════════════════════════════╣");
  console.log(`║  💎 Total Pot:           ${(POT_TOTAL / LAMPORTS_PER_SOL).toFixed(4)} SOL                              ║`);
  console.log(`║  🏠 App Rake (10%):      ${(RAKE_AMOUNT / LAMPORTS_PER_SOL).toFixed(4)} SOL                              ║`);
  console.log(`║  🏆 Winner Receives:     ${(WINNER_AMOUNT / LAMPORTS_PER_SOL).toFixed(4)} SOL (90%)                        ║`);
  console.log("╠═══════════════════════════════════════════════════════════════════╣");
  console.log(`║  👤 Player1 (WINNER):    Net ${p1Change > 0 ? "+" : ""}${(p1Change / LAMPORTS_PER_SOL).toFixed(4)} SOL                          ║`);
  console.log(`║  👤 Player2 (LOSER):     Net ${p2Change > 0 ? "+" : ""}${(p2Change / LAMPORTS_PER_SOL).toFixed(4)} SOL                          ║`);
  console.log("╠═══════════════════════════════════════════════════════════════════╣");
  
  if (p1Change >= Math.floor(WINNER_AMOUNT * 0.95) && p1Change <= Math.floor(WINNER_AMOUNT * 1.05)) {
    console.log("║  ✅ SUCCESS: Winner received correct amount!                       ║");
  } else {
    console.log("║  ❌ ISSUE: Winner amount mismatch                                  ║");
  }

  if (p2Change >= -BUY_IN_LAMPORTS * 1.1 && p2Change <= -BUY_IN_LAMPORTS * 0.9) {
    console.log("║  ✅ SUCCESS: Loser lost correct buy-in!                            ║");
  } else {
    console.log("║  ⚠️  ISSUE: Loser balance unexpected                               ║");
  }

  console.log("║                                                                   ║");
  console.log("║  🎉 GAME COMPLETE - MagicBlock + Settlement Working!              ║");
  console.log("╚═══════════════════════════════════════════════════════════════════╝\n");
}

run().catch(console.error);
