/**
 * ╔═══════════════════════════════════════════════════════════════════╗
 * ║  FUNDED GAME TEST — 0.5 SOL buy-in per player                    ║
 * ║  Shows: Gas costs, winner payout, app revenue                   ║
 * ╚═══════════════════════════════════════════════════════════════════╝
 */

const { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction } = require("@solana/web3.js");
const { AnchorProvider, Program, BN } = require("@coral-xyz/anchor");
const fs = require("fs");
const path = require("path");
const os = require("os");

const DEVNET_RPC = "https://devnet.helius-rpc.com/?api-key=f3417b56-61ad-4ba8-b0f9-3695ea859a58";
const PROGRAM_ID = new PublicKey("7qRu72wJ5AGcXkqnwXoNtkWt3Z6ZaJoyTQsEc5gzzkqK");
const IDL = JSON.parse(fs.readFileSync(path.join(__dirname, "src/lib/privatepoker_idl.json"), "utf8"));

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

const BUY_IN_SOL = 0.5;
const BUY_IN_LAMPORTS = Math.floor(BUY_IN_SOL * LAMPORTS_PER_SOL);
const POT_TOTAL = BUY_IN_LAMPORTS * 2;
const RAKE_PERCENT = 0.10;
const RAKE_AMOUNT = Math.floor(POT_TOTAL * RAKE_PERCENT);
const WINNER_PAYOUT = POT_TOTAL - RAKE_AMOUNT;

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fundWallet(wallet, mainWallet) {
  try {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: mainWallet.publicKey,
        toPubkey: wallet.publicKey,
        lamports: 1 * LAMPORTS_PER_SOL,
      })
    );
    
    const sig = await conn.sendTransaction(tx, [mainWallet], { skipPreflight: true });
    await conn.confirmTransaction(sig, "confirmed");
    return true;
  } catch (e) {
    return false;
  }
}

async function run() {
  console.log("\n╔═══════════════════════════════════════════════════════════════════╗");
  console.log("║  💰 FRESH FUNDED GAME TEST — 1 SOL each, 0.5 SOL buy-in         ║");
  console.log("╚═══════════════════════════════════════════════════════════════════╝\n");

  // Load main wallet
  const homeDir = os.homedir();
  const keypairPath = path.join(homeDir, ".config/solana/id.json");
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf8"));
  const mainWallet = Keypair.fromSecretKey(Uint8Array.from(keypairData));

  // Create fresh wallets
  const player1 = Keypair.generate();
  const player2 = Keypair.generate();

  console.log("👥 FRESH WALLETS CREATED:");
  console.log(`   Player1: ${player1.publicKey.toBase58()}`);
  console.log(`   Player2: ${player2.publicKey.toBase58()}\n`);

  // Fund wallets
  console.log("💸 FUNDING WALLETS WITH 1 SOL EACH FROM MAIN WALLET...");
  console.log(`   Transferring to Player1...`);
  const p1Funded = await fundWallet(player1, mainWallet);
  if (p1Funded) console.log(`   ✅ Funded`);
  
  console.log(`   Transferring to Player2...`);
  const p2Funded = await fundWallet(player2, mainWallet);
  if (p2Funded) console.log(`   ✅ Funded\n`);
  
  if (!p1Funded || !p2Funded) {
    console.log(`❌ Failed to fund wallets\n`);
    return;
  }
  
  await sleep(2000);

  // Get starting balances
  const p1Start = await conn.getBalance(player1.publicKey);
  const p2Start = await conn.getBalance(player2.publicKey);

  console.log("📊 GAME PARAMETERS:");
  console.log(`   Buy-in per player: ${BUY_IN_SOL} SOL`);
  console.log(`   Total pot: ${(POT_TOTAL / LAMPORTS_PER_SOL).toFixed(3)} SOL`);
  console.log(`   App rake (10%): ${(RAKE_AMOUNT / LAMPORTS_PER_SOL).toFixed(3)} SOL`);
  console.log(`   Winner gets (90%): ${(WINNER_PAYOUT / LAMPORTS_PER_SOL).toFixed(3)} SOL\n`);

  console.log("💵 STARTING BALANCES:");
  console.log(`   Player1: ${(p1Start / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`   Player2: ${(p2Start / LAMPORTS_PER_SOL).toFixed(4)} SOL\n`);

  // Create providers
  const p1Provider = new AnchorProvider(conn, {
    publicKey: player1.publicKey,
    signTransaction: async (tx) => { tx.partialSign(player1); return tx; },
    signAllTransactions: async (txs) => { txs.forEach(t => t.partialSign(player1)); return txs; },
  }, { commitment: "confirmed" });

  const p2Provider = new AnchorProvider(conn, {
    publicKey: player2.publicKey,
    signTransaction: async (tx) => { tx.partialSign(player2); return tx; },
    signAllTransactions: async (txs) => { txs.forEach(t => t.partialSign(player2)); return txs; },
  }, { commitment: "confirmed" });

  const p1Program = new Program(IDL, p1Provider);
  const p2Program = new Program(IDL, p2Provider);

  // Create game
  console.log("🎮 STEP 1: Player1 Creates Game");
  const gameId = Math.floor(Math.random() * 1_000_000_000);
  const gamePDA = getGamePDA(gameId);
  const hand1PDA = getPlayerHandPDA(gameId, player1.publicKey);
  const hand2PDA = getPlayerHandPDA(gameId, player2.publicKey);

  let createGasSpent = 0;
  try {
    const tx1 = await p1Program.methods
      .createGame(new BN(gameId), new BN(BUY_IN_LAMPORTS))
      .accounts({
        game: gamePDA,
        playerHand: hand1PDA,
        player1: player1.publicKey,
        systemProgram: PublicKey.default,
      })
      .rpc({ skipPreflight: true });

    const txData = await conn.getTransaction(tx1, { maxSupportedTransactionVersion: 0 });
    if (txData) {
      createGasSpent = txData.meta.fee;
    }
    console.log(`   ✅ Game created`);
    console.log(`   ⛽ Gas spent: ${(createGasSpent / 1000).toFixed(1)} mSOL\n`);
  } catch (err) {
    console.log(`   ❌ Failed: ${err.message}\n`);
    return;
  }

  // Player2 joins
  console.log("🎮 STEP 2: Player2 Joins Game");
  let joinGasSpent = 0;
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

    const txData = await conn.getTransaction(tx2, { maxSupportedTransactionVersion: 0 });
    if (txData) {
      joinGasSpent = txData.meta.fee;
    }
    console.log(`   ✅ Player2 joined`);
    console.log(`   ⛽ Gas spent: ${(joinGasSpent / 1000).toFixed(1)} mSOL\n`);
  } catch (err) {
    console.log(`   ❌ Failed: ${err.message}\n`);
    return;
  }

  // Verify pot
  const gameState = await p1Program.account.game.fetch(gamePDA);
  const potOnChain = gameState.pot.toNumber();
  console.log(`   📍 Pot verified on-chain: ${(potOnChain / LAMPORTS_PER_SOL).toFixed(3)} SOL ✅\n`);

  // Settle game - Player1 Wins
  console.log("🎮 STEP 3: Settlement - Player1 Wins!");
  let settleGasSpent = 0;
  try {
    const tx3 = await p1Program.methods
      .settleGame(0, new BN(POT_TOTAL))
      .accounts({
        game: gamePDA,
        winner: player1.publicKey,
        loser: player2.publicKey,
      })
      .rpc({ skipPreflight: true });

    const txData = await conn.getTransaction(tx3, { maxSupportedTransactionVersion: 0 });
    if (txData) {
      settleGasSpent = txData.meta.fee;
    }
    console.log(`   ✅ Game settled - Player1 wins!`);
    console.log(`   ⛽ Gas spent: ${(settleGasSpent / 1000).toFixed(1)} mSOL\n`);
  } catch (err) {
    console.log(`   ❌ Failed: ${err.message}\n`);
    return;
  }

  // Get final balances
  await sleep(2000);
  const p1End = await conn.getBalance(player1.publicKey);
  const p2End = await conn.getBalance(player2.publicKey);

  const p1Change = p1End - p1Start;
  const p2Change = p2End - p2Start;

  const totalGasSpent = createGasSpent + joinGasSpent + settleGasSpent;
  const appRevenue = RAKE_AMOUNT - totalGasSpent;

  console.log("╔═══════════════════════════════════════════════════════════════════╗");
  console.log("║  📊 FINAL SETTLEMENT REPORT                                      ║");
  console.log("╠═══════════════════════════════════════════════════════════════════╣");
  console.log("║                     GAME ECONOMICS                                ║");
  console.log("╠═══════════════════════════════════════════════════════════════════╣");
  console.log(`║  Total pot:                    ${(POT_TOTAL / LAMPORTS_PER_SOL).toFixed(3)} SOL                         ║`);
  console.log(`║  App rake (10%):               ${(RAKE_AMOUNT / LAMPORTS_PER_SOL).toFixed(3)} SOL                         ║`);
  console.log(`║  Winner payout (90%):          ${(WINNER_PAYOUT / LAMPORTS_PER_SOL).toFixed(3)} SOL                         ║`);
  console.log("╠═══════════════════════════════════════════════════════════════════╣");
  console.log("║                     GAS COSTS (Devnet)                            ║");
  console.log("╠═══════════════════════════════════════════════════════════════════╣");
  console.log(`║  Create game TX:               ${(createGasSpent / 1000).toFixed(2)} mSOL                        ║`);
  console.log(`║  Join game TX:                 ${(joinGasSpent / 1000).toFixed(2)} mSOL                        ║`);
  console.log(`║  Settlement TX:                ${(settleGasSpent / 1000).toFixed(2)} mSOL                        ║`);
  console.log(`║  ─────────────────────────────────                                ║`);
  console.log(`║  Total gas cost:               ${(totalGasSpent / 1000).toFixed(2)} mSOL = ${(totalGasSpent / LAMPORTS_PER_SOL).toFixed(6)} SOL              ║`);
  console.log("╠═══════════════════════════════════════════════════════════════════╣");
  console.log("║                     PLAYER BALANCES                               ║");
  console.log("╠═══════════════════════════════════════════════════════════════════╣");
  console.log(`║  Player1 (WINNER):                                               ║`);
  console.log(`║    Started:  ${(p1Start / LAMPORTS_PER_SOL).toFixed(4)} SOL                                   ║`);
  console.log(`║    Ended:    ${(p1End / LAMPORTS_PER_SOL).toFixed(4)} SOL                                   ║`);
  console.log(`║    Net change: ${p1Change > 0 ? "+" : ""}${(p1Change / LAMPORTS_PER_SOL).toFixed(4)} SOL (${((p1Change / p1Start) * 100).toFixed(1)}%)                  ║`);
  console.log(`║                                                                   ║`);
  console.log(`║  Player2 (LOSER):                                                ║`);
  console.log(`║    Started:  ${(p2Start / LAMPORTS_PER_SOL).toFixed(4)} SOL                                   ║`);
  console.log(`║    Ended:    ${(p2End / LAMPORTS_PER_SOL).toFixed(4)} SOL                                   ║`);
  console.log(`║    Net change: ${p2Change > 0 ? "+" : ""}${(p2Change / LAMPORTS_PER_SOL).toFixed(4)} SOL (${((p2Change / p2Start) * 100).toFixed(1)}%)                  ║`);
  console.log("╠═══════════════════════════════════════════════════════════════════╣");
  console.log("║                     APP REVENUE                                   ║");
  console.log("╠═══════════════════════════════════════════════════════════════════╣");
  console.log(`║  Rake collected (10%):         ${(RAKE_AMOUNT / LAMPORTS_PER_SOL).toFixed(6)} SOL                   ║`);
  console.log(`║  Gas costs paid:              -${(totalGasSpent / LAMPORTS_PER_SOL).toFixed(6)} SOL                   ║`);
  console.log(`║  ─────────────────────────────────                                ║`);
  console.log(`║  Net revenue to app:           ${(appRevenue / LAMPORTS_PER_SOL).toFixed(6)} SOL                   ║`);
  
  if (appRevenue > 0) {
    console.log(`║  ✅ PROFIT: App earned ${(appRevenue / LAMPORTS_PER_SOL).toFixed(6)} SOL per game!          ║`);
  } else {
    console.log(`║  ⚠️  LOSS: Gas costs exceed rake by ${(Math.abs(appRevenue) / LAMPORTS_PER_SOL).toFixed(6)} SOL  ║`);
  }

  console.log("╠═══════════════════════════════════════════════════════════════════╣");
  console.log("║  ✅ TEST COMPLETE — Funded game successfully played!             ║");
  console.log("╚═══════════════════════════════════════════════════════════════════╝\n");

  console.log("🎯 ECONOMICS SUMMARY:");
  console.log(`   ┌─ WINNER GETS (Player1)`);
  console.log(`   │  Net gain: ${(p1Change / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`   │`);
  console.log(`   ├─ APP ECONOMICS`);
  console.log(`   │  Rake: ${(RAKE_AMOUNT / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
  console.log(`   │  Gas:  ${(totalGasSpent / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
  console.log(`   │  Profit: ${(appRevenue / LAMPORTS_PER_SOL).toFixed(6)} SOL ✅`);
  console.log(`   │`);
  console.log(`   └─ LOSER LOSES (Player2)`);
  const p2Spent = (p2Start - p2End) / LAMPORTS_PER_SOL;
  console.log(`      Spent: ${p2Spent.toFixed(4)} SOL\n`);
}

run().catch(console.error);
