import { Connection, PublicKey, SystemProgram, Transaction, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import dotenv from 'dotenv';
dotenv.config();

const RPC_URL = 'https://api.mainnet-beta.solana.com';
const DONATION_ADDRESS = '7Gp94qayChFvR7cPX9gza9H62DUaQKMP9HFTcgwdykw';
const PRIVATE_KEY = process.env.PRIVATE_KEY;

function getWallet() {
  const privateKeyBytes = bs58.decode(PRIVATE_KEY);
  return Keypair.fromSecretKey(privateKeyBytes);
}

async function sendDonation() {
  const args = process.argv.slice(2);
  const amountArg = args.find(arg => arg.startsWith('--amount='));
  const DONATION_AMOUNT = amountArg ? parseFloat(amountArg.split('=')[1]) : 0.01;
  
  if (isNaN(DONATION_AMOUNT) || DONATION_AMOUNT <= 0) {
    console.log('[ERROR] Invalid amount. Use --amount=0.05 for custom amount');
    console.log('[INFO] Example: npm run donate -- --amount=0.05');
    process.exit(1);
  }
  
  console.log('[DONATE] Initiating donation...');
  console.log('------------------------------------------------------------');
  
  const connection = new Connection(RPC_URL, 'confirmed');
  const wallet = getWallet();
  const recipient = new PublicKey(DONATION_ADDRESS);
  
  console.log('[INFO] From:', wallet.publicKey.toBase58());
  console.log('[INFO] To:', DONATION_ADDRESS);
  console.log('[INFO] Amount:', DONATION_AMOUNT, 'SOL');
  console.log('------------------------------------------------------------\n');
  
  try {
    const balance = await connection.getBalance(wallet.publicKey);
    console.log('[INFO] Current balance:', (balance / LAMPORTS_PER_SOL).toFixed(4), 'SOL');
    
    if (balance < DONATION_AMOUNT * LAMPORTS_PER_SOL) {
      console.log('[ERROR] Insufficient balance');
      process.exit(1);
    }
    
    console.log('[DONATE] Creating transaction...');
    
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: recipient,
        lamports: Math.floor(DONATION_AMOUNT * LAMPORTS_PER_SOL),
      })
    );
    
    const { blockhash } = await connection.getLatestBlockhash('finalized');
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = wallet.publicKey;
    
    transaction.sign(wallet);
    console.log('[DONATE] Transaction signed');
    
    console.log('[DONATE] Sending...');
    const signature = await connection.sendRawTransaction(transaction.serialize());
    
    console.log('[SUCCESS] Transaction sent:', signature);
    console.log('[INFO] Explorer: https://solscan.io/tx/' + signature);
    
    console.log('[DONATE] Waiting for confirmation...');
    await connection.confirmTransaction(signature, 'confirmed');
    
    console.log('[SUCCESS] Donation confirmed');
    console.log('[INFO] Thank you for your support!');
    
    const newBalance = await connection.getBalance(wallet.publicKey);
    console.log('[INFO] New balance:', (newBalance / LAMPORTS_PER_SOL).toFixed(4), 'SOL');
    
  } catch (error) {
    console.error('[ERROR] Donation failed:', error.message);
    process.exit(1);
  }
}

sendDonation();