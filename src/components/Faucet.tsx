import { useWallet } from '@txnlab/use-wallet-react';
import { useSnackbar } from 'notistack';
import { useState, useEffect, useRef } from 'react';
import algosdk from 'algosdk';
import { getAlgodConfigFromViteEnvironment } from '../utils/network/getAlgoClientConfigs';
import AFCaptchaModal, { type AFCaptchaSolvePayload } from './AFCaptchaModal';
import { PeraWalletConnect } from '@perawallet/connect';

const CONTRACT_ID = 3054946205;
const CONTRACT_ADDRESS = algosdk.getApplicationAddress(CONTRACT_ID);

const CLAIM_SELECTOR = new TextEncoder().encode("claim");
const NOTE_BYTES = new TextEncoder().encode('AlgoFaucet');

// AFCaptcha app id (must match the faucet contract constant AFCAPTCHA_APP_ID)
// Allow override via Vite env for deployments.
const AFCAPTCHA_APP_ID = Number((import.meta as any).env?.VITE_AFCAPTCHA_APP_ID || 3371668755);
const AFCAPTCHA_NOTE = new TextEncoder().encode('AFCaptcha');

interface FaucetProps {
  openModal: boolean;
  setModalState: (value: boolean) => void;
  remainingBlocksText: string;
}

const Faucet = ({ openModal, setModalState, remainingBlocksText }: FaucetProps) => {
  const [loading, setLoading] = useState<boolean>(false);
  const [hasOptedIn, setHasOptedIn] = useState<boolean>(false);
  const [contractBalance, setContractBalance] = useState<number>(0);
  const [contractMBR, setContractMBR] = useState<number>(0);
  const [showCaptcha, setShowCaptcha] = useState<boolean>(false);
  const [captchaRoundRef, setCaptchaRoundRef] = useState<number>(0);
  const [captchaIdx, setCaptchaIdx] = useState<number>(0);
  const [captchaInitialState, setCaptchaInitialState] = useState<string>('');
  const { enqueueSnackbar } = useSnackbar();
  const { activeAddress, transactionSigner, signTransactions, activeWallet } = useWallet();

  const algodConfig = getAlgodConfigFromViteEnvironment();
  const algodClient = new algosdk.Algodv2(
    String(algodConfig.token),
    algodConfig.server,
    algodConfig.port
  );

  const fetchContractBalance = async (retries = 3) => {
    for (let i = 0; i < retries; i++) {
      let timeoutId: NodeJS.Timeout | null = null;
      try {
        // Ajouter un timeout personnalisé pour chaque tentative
        const controller = new AbortController();
        timeoutId = setTimeout(() => controller.abort(), 8000); // 8 secondes par tentative

        const accountInfo = await algodClient.accountInformation(CONTRACT_ADDRESS).do();
        if (timeoutId) clearTimeout(timeoutId);

        setContractBalance(Number(accountInfo.amount) / 1000000);
        setContractMBR(Number(accountInfo.minBalance) / 1000000);
        return; // Succès, sortir de la boucle
      } catch (e: any) {
        if (timeoutId) clearTimeout(timeoutId);

        if (i === retries - 1) {
          // Dernière tentative échouée
          if (e.name === 'AbortError') {
            enqueueSnackbar('Request timeout - please check your connection', { variant: 'warning' });
          } else {
            enqueueSnackbar('Failed to fetch contract balance', { variant: 'error' });
          }
          setContractBalance(0);
          setContractMBR(0);
        } else {
          // Attendre avant de réessayer (backoff exponentiel)
          const delay = 1000 * Math.pow(2, i); // 1s, 2s, 4s...
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
  };

  useEffect(() => {
    if (openModal) {
      fetchContractBalance();
    }
  }, [openModal]);

  useEffect(() => {
    try {
      window.dispatchEvent(new Event(openModal ? 'algofaucet:modal:open' : 'algofaucet:modal:close'))
    } catch {}
  }, [openModal])

  useEffect(() => {
    fetchContractBalance();
  }, []);

  useEffect(() => {
    const checkOptIn = async () => {
      if (!activeAddress) return;
      try {
        const response = await algodClient.getApplicationBoxes(CONTRACT_ID).do();
        const senderBytes = algosdk.decodeAddress(activeAddress).publicKey;
        const hasBox = response.boxes.some((box: any) => {
          const boxName = Buffer.from(box.name, 'base64');
          return Buffer.compare(boxName, senderBytes) === 0;
        });
        setHasOptedIn(hasBox);
      } catch (e: any) {
        if (e.status !== 404) {
          enqueueSnackbar('Failed to check box status', { variant: 'error' });
        }
        setHasOptedIn(false);
      }
    };

    checkOptIn();
  }, [activeAddress]);

  const fetchCurrentRound = async (): Promise<number> => {
    try {
      const status = await algodClient.status().do();
      const r = (status as any).lastRound ?? (status as any)['last-round'];
      const roundNum = typeof r === 'bigint' ? Number(r) : Number(r);
      return roundNum;
    } catch {
      // best-effort; modal will show waiting text
      return 0;
    }
  };

  const BASE_STATES: string[] = [
    '123450786','123456708','120453786','123405786','123406758','123456078','102453786','103425786','103426758','123045786',
    '123046758','123056478','123460758','123485706','012453786','013425786','013426758','023145786','023146758','023156478',
    '120463758','123468750','123485076','123485760','123506478','123745086','123746058','130425786','130426758','152403786',
  ];

  const fetchCaptchaChallenge = async (): Promise<void> => {
    // Pick a recent round_ref and derive idx from its VRF seed (Block.seed(round_ref))
    const r = await fetchCurrentRound();
    const roundRef = Math.max(1, r - 1);
    try {
      // Algod JS SDK: `algodClient.block(round).do()` returns an object containing `block.seed` (base64)
      const blk = await (algodClient as any).block(roundRef).do();
      const seedB64 =
        blk?.block?.seed ||
        blk?.seed ||
        blk?.block?.header?.seed ||
        '';
      if (!seedB64) throw new Error('Missing block seed');
      const seedBytes = Buffer.from(seedB64, 'base64');
      const first8 = seedBytes.subarray(0, 8);
      const n = BigInt('0x' + Buffer.from(first8).toString('hex'));
      const idx = Number(n % BigInt(BASE_STATES.length));
      setCaptchaRoundRef(roundRef);
      setCaptchaIdx(idx);
      setCaptchaInitialState(BASE_STATES[idx]);
    } catch (e) {
      // fallback: still open, but show error in modal submit
      console.error('[AFCaptcha] failed to fetch challenge', e);
      setCaptchaRoundRef(roundRef);
      setCaptchaIdx(0);
      setCaptchaInitialState(BASE_STATES[0]);
    }
  };

  useEffect(() => {
    if (!showCaptcha) return;
    fetchCurrentRound();
    const id = window.setInterval(fetchCurrentRound, 2000);
    return () => window.clearInterval(id);
  }, [showCaptcha]);

  const verifyNetwork = async (): Promise<boolean> => {
    try {
      const params = await algodClient.getTransactionParams().do();
      return params.genesisID.toLowerCase().startsWith('mainnet');
    } catch (e) {
      return false;
    }
  };

  // Cache compiled fee-payer LSig and its address
  const feePayerLsigRef = useRef<any>(null);
  const feePayerAddrRef = useRef<string | null>(null);

  const getOrCompileFeePayer = async (): Promise<{ lsig: any; address: string }> => {
    if (feePayerLsigRef.current && feePayerAddrRef.current) {
      return { lsig: feePayerLsigRef.current, address: feePayerAddrRef.current };
    }
    const teal = `#pragma version 6
txn TypeEnum
int pay
==

txn Receiver
txn Sender
==
&&

txn Amount
int 0
==
&&

txn RekeyTo
global ZeroAddress
==
&&

txn CloseRemainderTo
global ZeroAddress
==
&&

txn Fee
int 3000
>=
&&

txn GroupIndex
int 1
-
store 0

load 0
gtxns TypeEnum
int appl
==
&&

load 0
gtxns ApplicationID
int ${CONTRACT_ID}
==
&&

load 0
gtxns Fee
int 0
==
&&

load 0
gtxns NumAppArgs
int 1
>=
&&

load 0
gtxnsa ApplicationArgs 0
byte "claim"
==
&&

return`;
    const compileRes = await algodClient.compile(new TextEncoder().encode(teal)).do();
    const program = Uint8Array.from(Buffer.from(compileRes.result, 'base64'));
    const lsig = new (algosdk as any).LogicSigAccount(program);
    let addr: string | null = null;
    try {
      // Primary: derive from program
      addr = lsig.address().toString();
    } catch (e) {
      console.warn('[Faucet] Could not derive address from program, fallback to compile hash', e);
    }
    if (!addr && compileRes && typeof compileRes.hash === 'string') {
      addr = compileRes.hash;
    }
    // Validate address
    if (!addr || !algosdk.isValidAddress(addr)) {
      console.error('[Faucet] Invalid fee-payer address:', addr, 'compileRes.hash:', compileRes?.hash);
      throw new Error('Unable to determine fee-payer address');
    }
    if (!addr) {
      throw new Error('Unable to determine fee-payer address');
    }
    feePayerLsigRef.current = lsig;
    feePayerAddrRef.current = addr;
    return { lsig, address: addr };
  };
  const _keepRef = getOrCompileFeePayer; if (false) { console.debug(_keepRef); }

  const handleClaim = async () => {
    if (!activeAddress || !transactionSigner) {
      enqueueSnackbar('Please connect your wallet', { variant: 'error' });
      return;
    }

    const isMainnet = await verifyNetwork();
    if (!isMainnet) {
      enqueueSnackbar('Please switch to MainNet in your wallet', { variant: 'error' });
      return;
    }

    if (remainingBlocksText !== "Claim available!") {
      enqueueSnackbar('Claim not available yet', { variant: 'warning' });
      return;
    }

    setLoading(true);
    try {
      // Determine if captcha is required: new beneficiary == (no box) AND (wallet balance == 0)
      let isNewBeneficiary = false;
      try {
        const acct = await algodClient.accountInformation(activeAddress).do();
        const amt = Number((acct as any).amount ?? 0);
        isNewBeneficiary = (!hasOptedIn) && (amt === 0);
      } catch {
        // If we can't fetch, fall back to old flow (no captcha) to avoid blocking.
        isNewBeneficiary = false;
      }

      if (isNewBeneficiary) {
        await fetchCurrentRound();
        await fetchCaptchaChallenge();
        setShowCaptcha(true);
        setLoading(false);
        return;
      }

      const suggestedParams = await algodClient.getTransactionParams().do();

      const userBoxName = algosdk.decodeAddress(activeAddress).publicKey;

      const appCallTxn = algosdk.makeApplicationCallTxnFromObject({
        sender: activeAddress,
        appIndex: CONTRACT_ID,
        onComplete: algosdk.OnApplicationComplete.NoOpOC,
        appArgs: [CLAIM_SELECTOR],
        boxes: [{ appIndex: CONTRACT_ID, name: userBoxName }],
        note: NOTE_BYTES,
        suggestedParams: { ...suggestedParams, fee: 0, flatFee: true }
      });

      // Build fee-payer locally (no serverless) using compiled address (compileRes.hash or lsig.address)
      const { lsig: feePayerLsig } = await getOrCompileFeePayer();
      const feeAddr = (feePayerLsig as any).address().toString();
      if (!feeAddr || !algosdk.isValidAddress(feeAddr)) {
        throw new Error('Invalid fee-payer address');
      }
      const paramsFee = await algodClient.getTransactionParams().do();
      const feePayTxn: any = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: feeAddr,
        receiver: feeAddr,
        amount: 0,
        suggestedParams: { ...paramsFee, fee: 3000, flatFee: true } as any,
      } as any);

      const [g0, g1] = algosdk.assignGroupID([appCallTxn as any, feePayTxn as any]);
      const signedUser = await transactionSigner([g0 as any, g1 as any], [0]);
      const signedFee = (algosdk as any).signLogicSigTransaction(g1 as any, feePayerLsig as any).blob;
      const response = await algodClient.sendRawTransaction([signedUser[0] as unknown as Uint8Array, signedFee]).do();
      await algosdk.waitForConfirmation(algodClient, response.txid, 4);

      await fetchContractBalance();
      enqueueSnackbar('Successfully claimed ALGO!', { variant: 'success' });
      window.dispatchEvent(new Event('algofaucet:refresh-balance'));
      setTimeout(() => setModalState(false), 2000);

    } catch (e: any) {
      console.error('Claim error:', e);
      enqueueSnackbar(`Failed to claim: ${e.message || 'Please try again later.'}`, { variant: 'error' });
    }
    setLoading(false);
  };

  const handleCaptchaSolveAndClaim = async (payload: AFCaptchaSolvePayload) => {
    if (!activeAddress || !transactionSigner || !signTransactions) {
      enqueueSnackbar('Please connect your wallet', { variant: 'error' });
      return;
    }
    const isMainnet = await verifyNetwork();
    if (!isMainnet) {
      enqueueSnackbar('Please switch to MainNet in your wallet', { variant: 'error' });
      return;
    }
    setLoading(true);
    try {
      const userBoxName = algosdk.decodeAddress(activeAddress).publicKey;

      const spSolve: any = await algodClient.getTransactionParams().do();
      // CRITICAL: For `block BlkSeed` / `Block.seed(round_ref)` to be available, the referenced round must be tied to
      // the txn validity window. The reliable pattern (used by your python scripts) is:
      //   first_valid = round_ref + 1
      // This keeps the block reference deterministic and available.
      const firstValid = BigInt(Number(payload.roundRef) + 1);
      spSolve.firstValid = firstValid;
      // Keep a reasonable window (like the python scripts) to avoid long-lived mempool txns.
      spSolve.lastValid = firstValid + BigInt(50);

      const solveTxn = algosdk.makeApplicationCallTxnFromObject({
        sender: activeAddress,
        appIndex: AFCAPTCHA_APP_ID,
        onComplete: algosdk.OnApplicationComplete.NoOpOC,
        appArgs: [
          new TextEncoder().encode('solve'),
          algosdk.encodeUint64(payload.roundRef),
          new TextEncoder().encode(payload.initialState),
          new TextEncoder().encode(payload.movesAscii),
          new TextEncoder().encode('123456780'),
        ],
        note: AFCAPTCHA_NOTE,
        suggestedParams: { ...spSolve, fee: 0, flatFee: true } as any,
      });

      const claimTxn = algosdk.makeApplicationCallTxnFromObject({
        sender: activeAddress,
        appIndex: CONTRACT_ID,
        onComplete: algosdk.OnApplicationComplete.NoOpOC,
        appArgs: [CLAIM_SELECTOR],
        boxes: [{ appIndex: CONTRACT_ID, name: userBoxName }],
        note: NOTE_BYTES,
        suggestedParams: { ...spSolve, fee: 0, flatFee: true } as any,
      });

      const { lsig: feePayerLsig } = await getOrCompileFeePayer();
      const feeAddr = (feePayerLsig as any).address().toString();
      if (!feeAddr || !algosdk.isValidAddress(feeAddr)) {
        throw new Error('Invalid fee-payer address');
      }

      // Use same validity window as solve/claim so group is coherent.
      const spFee: any = await algodClient.getTransactionParams().do();
      spFee.firstValid = spSolve.firstValid;
      spFee.lastValid = spSolve.lastValid;

      // Add opcode budget like `play_afcaptcha.py`: group extra cheap calls to AFCaptcha ("ping").
      // Important: faucet contract requires txn[0] to be the "solve" call, so pings must come AFTER solve.
      const ping1 = algosdk.makeApplicationCallTxnFromObject({
        sender: activeAddress,
        appIndex: AFCAPTCHA_APP_ID,
        onComplete: algosdk.OnApplicationComplete.NoOpOC,
        appArgs: [new TextEncoder().encode('ping'), new TextEncoder().encode('1')],
        note: AFCAPTCHA_NOTE,
        suggestedParams: { ...spFee, fee: 0, flatFee: true } as any,
      });
      const ping2 = algosdk.makeApplicationCallTxnFromObject({
        sender: activeAddress,
        appIndex: AFCAPTCHA_APP_ID,
        onComplete: algosdk.OnApplicationComplete.NoOpOC,
        appArgs: [new TextEncoder().encode('ping'), new TextEncoder().encode('2')],
        note: AFCAPTCHA_NOTE,
        suggestedParams: { ...spFee, fee: 0, flatFee: true } as any,
      });

      // Fee payer (faucet LogicSig) pays for the whole group, so the new user can sign fee=0.
      const feePayTxn: any = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: feeAddr,
        receiver: feeAddr,
        amount: 0,
        // Faucet `claim` performs 1 inner payment txn, so total required fee ~= minFee * (group_size + inner_count).
        // group_size=5 and inner_count=1 => 6 * 1000 = 6000.
        suggestedParams: { ...spFee, fee: BigInt(6000), flatFee: true } as any,
      } as any);

      const group = [solveTxn as any, ping1 as any, ping2 as any, claimTxn as any, feePayTxn as any];
      const groupId = algosdk.computeGroupID(group);
      (solveTxn as any).group = groupId;
      (ping1 as any).group = groupId;
      (ping2 as any).group = groupId;
      (claimTxn as any).group = groupId;
      (feePayTxn as any).group = groupId;

      // Signing strategy:
      // - For Pera mobile, avoid `signers: []` (can trigger "Missing transaction(s)") by using @perawallet/connect directly
      //   with explicit signers lists.
      // - For other wallets, keep the normal use-wallet flow.
      let signedSolve: Uint8Array | null = null;
      let signedPing1: Uint8Array | null = null;
      let signedPing2: Uint8Array | null = null;
      let signedClaim: Uint8Array | null = null;

      if (activeWallet?.id === 'pera') {
        const pera = new PeraWalletConnect({ chainId: 416001 } as any);
        const accounts: string[] = await pera.reconnectSession().catch(() => []);
        if (!accounts || accounts.length === 0) {
          throw new Error('Pera session not found. Please reconnect your wallet.')
        }
        if (!accounts.includes(activeAddress)) {
          throw new Error('Pera session account mismatch. Please disconnect and reconnect Pera.')
        }
        // Pera mobile can throw "Missing private key(s)" if the request doesn't explicitly specify
        // which txns should be signed. We bypass the helper `pera.signTransaction` and send the
        // WalletConnect request ourselves with explicit per-txn `signers`.
        const connector: any = (pera as any).connector;
        if (!connector) {
          throw new Error('Pera connector not initialized. Please reconnect your wallet.')
        }
        const toB64Unsigned = (txn: any) => Buffer.from(algosdk.encodeUnsignedTransaction(txn)).toString('base64')
        // Pera mobile is most compatible when `signers` is omitted for txns it should sign (it signs by sender),
        // and `signers: []` is used only for txns it must skip.
        const reqParams: any[] = [
          { txn: toB64Unsigned(solveTxn as any) },
          { txn: toB64Unsigned(ping1 as any) },
          { txn: toB64Unsigned(ping2 as any) },
          { txn: toB64Unsigned(claimTxn as any) },
          { txn: toB64Unsigned(feePayTxn as any), signers: [] }, // skip signing (LogicSig will sign locally)
        ];
        const request = {
          id: Date.now() * 1_000 + Math.floor(Math.random() * 1_000),
          jsonrpc: '2.0',
          method: 'algo_signTxn',
          params: [reqParams],
        };
        const result: any[] = await connector.sendCustomRequest(request, { forcePushNotification: true });
        const signedArr = (result || []);
        // Expect 5 entries: signed base64 strings for txns Pera signed, null for skipped.
        const decodeB64 = (s: string) => Uint8Array.from(Buffer.from(s, 'base64'));
        if (!signedArr[0] || !signedArr[1] || !signedArr[2] || !signedArr[3]) {
          throw new Error('Wallet did not sign required transactions');
        }
        signedSolve = decodeB64(signedArr[0]);
        signedPing1 = decodeB64(signedArr[1]);
        signedPing2 = decodeB64(signedArr[2]);
        signedClaim = decodeB64(signedArr[3]);
      } else {
        // In our 5-txn group, user signs txn[0]=solve, txn[1]=ping1, txn[2]=ping2, txn[3]=claim.
        const signedGroup = await signTransactions(group, [0, 1, 2, 3]);
        signedSolve = signedGroup[0] as any;
        signedPing1 = signedGroup[1] as any;
        signedPing2 = signedGroup[2] as any;
        signedClaim = signedGroup[3] as any;
      }

      if (!signedSolve || !signedPing1 || !signedPing2 || !signedClaim) {
        throw new Error('Wallet did not sign required transactions');
      }

      const signedFee = (algosdk as any).signLogicSigTransaction(feePayTxn as any, feePayerLsig as any).blob;

      const response = await algodClient.sendRawTransaction([
        signedSolve as unknown as Uint8Array,
        signedPing1 as unknown as Uint8Array,
        signedPing2 as unknown as Uint8Array,
        signedClaim as unknown as Uint8Array,
        signedFee,
      ]).do();
      await algosdk.waitForConfirmation(algodClient, response.txid, 6);

      setHasOptedIn(true);
      await fetchContractBalance();
      enqueueSnackbar('Captcha verified — claim sent!', { variant: 'success' });
      window.dispatchEvent(new Event('algofaucet:refresh-balance'));
      setTimeout(() => setModalState(false), 2000);
    } catch (e: any) {
      console.error('Captcha+Claim error:', e);
      enqueueSnackbar(`Captcha claim failed: ${e?.message || 'Please try again later.'}`, { variant: 'error' });
      throw e;
    } finally {
      setLoading(false);
    }
  };

  return (
    openModal && (
      <>
        <AFCaptchaModal
          open={showCaptcha}
          roundRef={captchaRoundRef}
          initialState={captchaInitialState}
          idx={captchaIdx}
          onRequestClose={() => setShowCaptcha(false)}
          onSolveAndClaim={handleCaptchaSolveAndClaim}
        />
        <div data-modal-root="true" style={{
          position: 'fixed',
          top: '35%',
          left: 0,
          right: 0,
          bottom: 0,
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-start',
          alignItems: 'center',
          zIndex: 15000,
          pointerEvents: 'none'
        }}>
          <div style={{
            width: '80%',
            maxWidth: '300px',
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            backdropFilter: 'blur(8px)',
            borderRadius: '20px',
            padding: '1rem',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            boxSizing: 'border-box',
            margin: '0 auto',
            pointerEvents: 'auto',
            position: 'relative'
          }}
          onClick={(e) => { e.stopPropagation(); }}
          onTouchStart={(e) => { e.stopPropagation(); }}
          >
            {/* Buttons row: GLN - CLAIM - AlgoPuzzle */}
            <div style={{ fontSize: '1.1rem', fontWeight: 400, color: '#FFFFFF', marginBottom: '1rem', textAlign: 'center' }}>
              FAUCET
            </div>
            <div style={{ fontSize: '1.1rem', fontWeight: 600, color: '#FFFFFF', marginBottom: '0.01rem', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '1.1rem', fontWeight: 600 }}>
                {'['}
                <img src="/A.png" alt="ALGO balance" style={{ width: 16, height: 16 }} />
                <span>{contractBalance}</span>
                {']'}
              </span>
            </div>
            <div style={{ fontSize: '0.55rem', fontWeight: 400, color: '#FFFFFF', marginBottom: '0.5rem', textAlign: 'center', opacity: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              <img src="/icon_lock.png" alt="MBR lock" style={{ width: 10, height: 10 }} />
              <span>{contractMBR} ALGO</span>
            </div>
            <div style={{ fontSize: '0.9rem', fontWeight: 400, color: '#FFFFFF', marginBottom: '1.2rem', textAlign: 'center' }}>
              {remainingBlocksText}
            </div>

            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <button
                className="claim-button"
                onClick={handleClaim}
                disabled={loading || remainingBlocksText !== "Claim available!"}
                style={{
                  height: 36,
                  padding: '0 14px',
                  minWidth: 120,
                  border: '2px solid #FFFFFF',
                  borderRadius: 50,
                  color: 'white',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12,
                  cursor: (loading || remainingBlocksText !== "Claim available!") ? 'not-allowed' : 'pointer',
                  opacity: (loading || remainingBlocksText !== "Claim available!") ? 0.5 : 1,
                  backgroundColor: 'transparent',
                  textAlign: 'center',
                }}
              >
                {loading ? 'Processing...' : 'CLAIM'}
              </button>
            </div>
          </div>
          {/* Sticky footer ad removed */}
        </div>
      </>
    )
  );
};

export default Faucet;
