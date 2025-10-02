import { Connection, PublicKey, Transaction, TransactionInstruction, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

const RPC_URL = 'https://api.mainnet-beta.solana.com';
const WEED_PROGRAM_ID = '5f6jnqJUNkUvWvwuqvTvmbQS1REjSsgTtZ75KercWNnG';
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CHECK_INTERVAL = 30 * 60 * 1000;
const CACHE_FILE = 'accounts-cache.json';
const SCAN_DELAY = 1000;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function formatTimeRemaining(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function getWallet() {
  const privateKeyBytes = bs58.decode(PRIVATE_KEY);
  return Keypair.fromSecretKey(privateKeyBytes);
}

function loadCache(walletAddress) {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      if (cache[walletAddress]) {
        console.log('[CACHE] Loaded cached accounts');
        return cache[walletAddress];
      }
    }
  } catch (error) {
    console.log('[CACHE] No cache found, will scan');
  }
  return null;
}

function saveCache(walletAddress, accounts) {
  try {
    let cache = {};
    if (fs.existsSync(CACHE_FILE)) {
      cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    }
    cache[walletAddress] = accounts;
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
    console.log('[CACHE] Saved to cache');
  } catch (error) {
    console.log('[CACHE] Failed to save:', error.message);
  }
}

async function scanForAccounts(connection, wallet) {
  console.log('[SCAN] Starting scan...');
  console.log('[SCAN] Rate limit: 1 second between requests');
  
  const CLAIM_DISCRIMINATOR = Buffer.from([4, 144, 132, 71, 116, 23, 151, 80]);
  
  try {
    const signatures = await connection.getSignaturesForAddress(
      wallet.publicKey,
      { limit: 50 }
    );
    
    console.log(`[SCAN] Found ${signatures.length} transactions\n`);
    
    for (let i = 0; i < signatures.length; i++) {
      console.log(`[${i + 1}/${signatures.length}] Checking transaction...`);
      
      if (i > 0) {
        await sleep(SCAN_DELAY);
      }
      
      const tx = await connection.getTransaction(signatures[i].signature, {
        maxSupportedTransactionVersion: 0
      });
      
      if (!tx || !tx.transaction) {
        console.log('Transaction empty, skipping\n');
        continue;
      }
      
      const programIds = tx.transaction.message.compiledInstructions
        .map(ix => tx.transaction.message.staticAccountKeys[ix.programIdIndex].toBase58());
      
      const isWeedTx = programIds.includes(WEED_PROGRAM_ID);
      
      if (isWeedTx) {
        const weedIxIndex = tx.transaction.message.compiledInstructions.findIndex(
          ix => tx.transaction.message.staticAccountKeys[ix.programIdIndex].toBase58() === WEED_PROGRAM_ID
        );
        
        if (weedIxIndex !== -1) {
          const weedIx = tx.transaction.message.compiledInstructions[weedIxIndex];
          const instructionData = weedIx.data;
          
          const isClaimRewards = instructionData.slice(0, 8).equals(CLAIM_DISCRIMINATOR);
          
          if (isClaimRewards) {
            const accountKeys = tx.transaction.message.staticAccountKeys;
            const accounts = weedIx.accountKeyIndexes.map(idx => accountKeys[idx].toBase58());
            
            if (accounts.length >= 11) {
              console.log('\n[SCAN] WEED transaction found');
              console.log('[SCAN] Signature:', signatures[i].signature);
              console.log('[SCAN] Explorer: https://solscan.io/tx/' + signatures[i].signature);
              console.log('\n[SCAN] Accounts:');
              console.log('  FARM_STATE      :', accounts[0]);
              console.log('  USER_FARM       :', accounts[1]);
              console.log('  GLOBAL_STATE    :', accounts[2]);
              console.log('  WEED_MINT       :', accounts[3]);
              console.log('  MINT_AUTHORITY  :', accounts[4]);
              console.log('  USER_TOKEN_ACC  :', accounts[5]);
              console.log('  USER_WALLET     :', accounts[6]);
              console.log('  TOKEN_PROGRAM   :', accounts[7]);
              console.log('  SYSTEM_PROGRAM  :', accounts[8]);
              console.log('  FEE_ACCOUNT_1   :', accounts[9]);
              console.log('  FEE_ACCOUNT_2   :', accounts[10]);
              
              const accountsData = {
                farmState: accounts[0],
                userFarm: accounts[1],
                globalState: accounts[2],
                weedMint: accounts[3],
                mintAuthority: accounts[4],
                userTokenAccount: accounts[5],
                wallet: accounts[6],
                tokenProgram: accounts[7],
                systemProgram: accounts[8],
                feeAccount1: accounts[9],
                feeAccount2: accounts[10],
                txSignature: signatures[i].signature
              };
              
              return accountsData;
            }
          }
        }
      } else {
        console.log('Not a WEED transaction\n');
      }
    }
    
    console.log('[SCAN] No claim transaction found');
    console.log('[SCAN] Please perform at least one manual claim first');
    return null;
    
  } catch (error) {
    console.error('[SCAN] Error:', error.message);
    return null;
  }
}

function buildClaimInstruction(wallet, accounts) {
  const instructionData = Buffer.from([4, 144, 132, 71, 116, 23, 151, 80]);

  const keys = [
    { pubkey: new PublicKey(accounts.farmState), isSigner: false, isWritable: true },
    { pubkey: new PublicKey(accounts.userFarm), isSigner: false, isWritable: true },
    { pubkey: new PublicKey(accounts.globalState), isSigner: false, isWritable: true },
    { pubkey: new PublicKey(accounts.weedMint), isSigner: false, isWritable: true },
    { pubkey: new PublicKey(accounts.mintAuthority), isSigner: false, isWritable: false },
    { pubkey: new PublicKey(accounts.userTokenAccount), isSigner: false, isWritable: true },
    { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
    { pubkey: new PublicKey(accounts.tokenProgram), isSigner: false, isWritable: false },
    { pubkey: new PublicKey(accounts.systemProgram), isSigner: false, isWritable: false },
    { pubkey: new PublicKey(accounts.feeAccount1), isSigner: false, isWritable: true },
    { pubkey: new PublicKey(accounts.feeAccount2), isSigner: false, isWritable: true },
  ];

  return new TransactionInstruction({
    keys,
    programId: new PublicKey(WEED_PROGRAM_ID),
    data: instructionData,
  });
}

async function checkRewards(connection, accounts) {
  try {
    const accountInfo = await connection.getAccountInfo(new PublicKey(accounts.userFarm));
    if (!accountInfo) {
      console.log('[ERROR] User farm account not found');
      return null;
    }
    
    console.log('[INFO] User farm verified');
    return accountInfo;
  } catch (error) {
    console.error('[ERROR] Check failed:', error.message);
    return null;
  }
}

async function claimRewards(connection, wallet, accounts) {
  try {
    console.log('\n[CLAIM] Initiating claim...');
    
    const instruction = buildClaimInstruction(wallet, accounts);
    const transaction = new Transaction().add(instruction);
    
    console.log('[CLAIM] Fetching blockhash...');
    const { blockhash } = await connection.getLatestBlockhash('finalized');
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = wallet.publicKey;
    
    transaction.sign(wallet);
    console.log('[CLAIM] Transaction signed');
    
    console.log('[CLAIM] Sending...');
    const signature = await connection.sendRawTransaction(
      transaction.serialize(),
      {
        skipPreflight: false,
        preflightCommitment: 'finalized',
        maxRetries: 3,
      }
    );
    
    console.log('[SUCCESS] Sent:', signature);
    console.log('[INFO] https://solscan.io/tx/' + signature);
    
    console.log('[CLAIM] Waiting for confirmation...');
    const startTime = Date.now();
    const timeout = 60000;
    
    while (Date.now() - startTime < timeout) {
      const status = await connection.getSignatureStatus(signature);
      
      if (status?.value?.confirmationStatus === 'confirmed' || 
          status?.value?.confirmationStatus === 'finalized') {
        
        if (status.value.err) {
          console.log('[ERROR] Failed:', JSON.stringify(status.value.err));
          
          try {
            const txDetails = await connection.getTransaction(signature, {
              maxSupportedTransactionVersion: 0
            });
            if (txDetails?.meta?.logMessages) {
              console.log('[LOGS]');
              txDetails.meta.logMessages.forEach(log => console.log('  ', log));
            }
          } catch (e) {
            // Ignore
          }
          
          return false;
        }
        
        console.log('[SUCCESS] Confirmed');
        return true;
      }
      
      await sleep(2000);
    }
    
    console.log('[WARN] Timeout after 60s');
    console.log('[INFO] Check: https://solscan.io/tx/' + signature);
    return false;
    
  } catch (error) {
    console.error('[ERROR] Claim failed:', error.message);
    
    if (error.logs) {
      console.log('[LOGS]');
      error.logs.forEach(log => console.log('  ', log));
    }
    
    return false;
  }
}

async function waitWithCountdown(totalMs) {
  const updateInterval = 60000;
  const startTime = Date.now();
  const endTime = startTime + totalMs;
  
  while (Date.now() < endTime) {
    const remaining = endTime - Date.now();
    if (remaining <= 0) break;
    
    const nextUpdate = new Date(Date.now() + Math.min(remaining, updateInterval));
    console.log(`[WAIT] Next check in ${formatTimeRemaining(remaining)} (${nextUpdate.toLocaleTimeString('en-US')})`);
    
    await sleep(Math.min(remaining, updateInterval));
  }
}

async function main() {
  console.log('[START] WEED Auto-Claim Bot v2.0');
  console.log('------------------------------------------------------------');
  
  const connection = new Connection(RPC_URL, {
    commitment: 'finalized',
    confirmTransactionInitialTimeout: 60000,
  });
  
  const wallet = getWallet();
  const walletAddress = wallet.publicKey.toBase58();
  
  console.log('[CONFIG] Wallet:', walletAddress);
  console.log('[CONFIG] Interval: 30 minutes');
  console.log('------------------------------------------------------------\n');
  
  let accounts = loadCache(walletAddress);
  
  if (!accounts) {
    console.log('[INIT] No cache found');
    console.log('[INIT] Scanning history (1-2 minutes)...\n');
    
    accounts = await scanForAccounts(connection, wallet);
    
    if (!accounts) {
      console.log('\n[FATAL] No accounts found');
      console.log('[FATAL] Perform at least one manual claim first');
      process.exit(1);
    }
    
    saveCache(walletAddress, accounts);
    console.log('\n[INIT] Discovery complete');
  }
  
  console.log('\n[INFO] Accounts loaded');
  console.log('  User Farm:', accounts.userFarm);
  console.log('  Token Account:', accounts.userTokenAccount);
  console.log('  Reference TX:', accounts.txSignature);
  console.log('------------------------------------------------------------\n');
  
  let iteration = 0;
  
  while (true) {
    iteration++;
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] Iteration #${iteration}`);
    console.log('------------------------------------------------------------');
    
    try {
      const balance = await connection.getBalance(wallet.publicKey);
      console.log('[INFO] Balance:', (balance / 1e9).toFixed(4), 'SOL');
      
      if (balance < 0.001 * 1e9) {
        console.log('[WARN] Low SOL balance');
      }
      
      const rewardsInfo = await checkRewards(connection, accounts);
      
      if (rewardsInfo) {
        const success = await claimRewards(connection, wallet, accounts);
        
        if (success) {
          console.log('[SUCCESS] Rewards claimed');
        }
      }
      
    } catch (error) {
      console.error('[ERROR] Loop error:', error.message);
    }
    
    console.log('');
    await waitWithCountdown(CHECK_INTERVAL);
  }
}

process.on('unhandledRejection', (error) => {
  console.error('[FATAL] Unhandled:', error);
});

process.on('SIGINT', () => {
  console.log('\n[STOP] Shutting down...');
  process.exit(0);
});

main().catch(error => {
  console.error('[FATAL] Error:', error);
  process.exit(1);
});