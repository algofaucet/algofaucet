import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useWallet } from '@txnlab/use-wallet-react';
import { useSnackbar } from 'notistack';
import algosdk from 'algosdk';
import { getAlgodConfigFromViteEnvironment, getIndexerConfigFromViteEnvironment } from '../utils/network/getAlgoClientConfigs';

const FAUCET_ADDRESS = 'SSXB2UBGC2WEPKP7TWTKWPVJQWE5JM6XLIRYNIIUYA4XPITOYWGUSQ5BPY';
const LOGICSIG_ADDRESS = 'TSCTPYQI3U52IUC4GLXOY2TUPSZFSAW5HG5LXVJEDZW7D4GRBINPY5GB5U';
const CREATOR_ADDRESS = 'GKUQEBSHVTZL4FYW7XR45EKT37XYT75VJXWGGO3NMZRHDFSAHPOY2CRBLM';
const FAUCET_URL = `https://explorer.perawallet.app/address/${FAUCET_ADDRESS}/`;
const LOGICSIG_URL = `https://explorer.perawallet.app/address/${LOGICSIG_ADDRESS}/`;
const CREATOR_URL = `https://explorer.perawallet.app/address/${CREATOR_ADDRESS}/`;

type DonationEntry = { sender: string; amountMicro: number; round: number; txid: string };

const Donation: React.FC = () => {
  const { activeAddress, transactionSigner } = useWallet();
  const { enqueueSnackbar } = useSnackbar();

  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'donate' | 'top'>('donate');
  const [contentOpacity, setContentOpacity] = useState(1);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const [donationAmt, setDonationAmt] = useState<string>('');
  const [sending, setSending] = useState(false);

  const [donations, setDonations] = useState<DonationEntry[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [indexerAvailable, setIndexerAvailable] = useState<boolean>(true);
  const [userBalance, setUserBalance] = useState<number | null>(null);
  const [userMBR, setUserMBR] = useState<number | null>(null);

  const algodClient = useMemo(() => {
    const cfg = getAlgodConfigFromViteEnvironment();
    return new algosdk.Algodv2(String(cfg.token), cfg.server, cfg.port);
  }, []);

  const indexerClient = useMemo(() => {
    try {
      const cfg = getIndexerConfigFromViteEnvironment();
      return new algosdk.Indexer(String(cfg.token as any), cfg.server, cfg.port);
    } catch {
      setIndexerAvailable(false);
      return null;
    }
  }, []);

  const verifyNetwork = async (): Promise<boolean> => {
    try {
      const sp = await algodClient.getTransactionParams().do();
      return (sp as any)?.genesisID?.toLowerCase?.().startsWith('mainnet');
    } catch {
      return false;
    }
  };

  const shorten = (address: string) => `${address.slice(0, 3)}...${address.slice(-3)}`;

  const handleCopy = async (textToCopy: string) => {
    try {
      await navigator.clipboard.writeText(textToCopy);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const smoothSwitchTab = (tab: 'donate' | 'top') => {
    if (tab === activeTab) return;
    setContentOpacity(0);
    window.setTimeout(() => {
      setActiveTab(tab);
      if (contentRef.current) contentRef.current.scrollTop = 0;
      window.setTimeout(() => setContentOpacity(1), 60);
    }, 160);
  };

  const fetchTopDonations = async () => {
    if (!indexerClient) return;
    setLoadingList(true);
    try {
      const res = await (indexerClient as any)
        .searchForTransactions()
        .txType('pay')
        .address(FAUCET_ADDRESS)
        .addressRole('receiver')
        .limit(100)
        .do();
      const txs = (res?.transactions || []) as any[];
      const hasDonationNote = (t: any): boolean => {
        const noteB64 = t?.note;
        if (!noteB64) return false;
        try {
          const bytes = Uint8Array.from(Buffer.from(noteB64, 'base64'));
          const note = new TextDecoder().decode(bytes).replace(/\0+$/,'').trim();
          return note === 'Donation';
        } catch {
          return false;
        }
      };
      const filtered = txs.filter(hasDonationNote);
      const entries: DonationEntry[] = filtered.map((t) => ({
        sender: t.sender,
        amountMicro: Number(t?.paymentTransaction?.amount || 0),
        round: Number(t['confirmed-round'] || t['confirmedRound'] || 0),
        txid: String(t.id || t.txid || '')
      }));
      entries.sort((a, b) => b.amountMicro - a.amountMicro);
      setDonations(entries);
    } catch (e) {
      setIndexerAvailable(false);
    }
    setLoadingList(false);
  };

  useEffect(() => {
    if (!open) return;
    if (activeTab === 'top') fetchTopDonations();
  }, [open, activeTab]);

  const fetchUserAccountStats = async () => {
    if (!activeAddress) { setUserBalance(null); setUserMBR(null); return }
    try {
      const info = await algodClient.accountInformation(activeAddress).do();
      setUserBalance(Number(info.amount || 0) / 1_000_000);
      setUserMBR(Number(info.minBalance || 0) / 1_000_000);
    } catch {
      setUserBalance(null);
      setUserMBR(null);
    }
  };

  useEffect(() => {
    if (!open || activeTab !== 'donate') return;
    fetchUserAccountStats();
  }, [open, activeTab, activeAddress]);

  const performDonate = async (amtAlgo: number) => {
    if (!activeAddress || !transactionSigner) {
      enqueueSnackbar('Please connect your wallet first', { variant: 'error' });
      return;
    }
    if (!isFinite(amtAlgo) || amtAlgo <= 0) {
      enqueueSnackbar('Invalid amount', { variant: 'error' });
      return;
    }
    const isMainnet = await verifyNetwork();
    if (!isMainnet) {
      enqueueSnackbar('Please switch to MainNet in your wallet', { variant: 'error' });
      return;
    }
    setSending(true);
    try {
      const sp = await algodClient.getTransactionParams().do();
      const amt = Math.round(amtAlgo * 1_000_000);
      const note = new TextEncoder().encode('Donation');
      const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: activeAddress,
        receiver: FAUCET_ADDRESS,
        amount: amt,
        note,
        suggestedParams: sp as any,
      } as any);
      const signed = await transactionSigner([txn], [0]);
      const res = await algodClient.sendRawTransaction(signed).do();
      await algosdk.waitForConfirmation(algodClient, res.txid, 6);
      enqueueSnackbar('Donation sent! Thank you ❤️', { variant: 'success' });
      setDonationAmt('');
      await fetchUserAccountStats();
      try { window.dispatchEvent(new Event('algofaucet:refresh-balance')); } catch {}
      if (activeTab === 'top') fetchTopDonations();
    } catch (e: any) {
      enqueueSnackbar(`Donation failed: ${e?.message || 'error'}`, { variant: 'error' });
    }
    setSending(false);
  };

  useEffect(() => {
    try {
      window.dispatchEvent(new Event(open ? 'algofaucet:modal:open' : 'algofaucet:modal:close'))
    } catch {}
  }, [open])

  const Row: React.FC<{ label: string; address: string; linkUrl: string }> = ({ label, address, linkUrl }) => (
    <div
      style={{
        marginTop: '0.5rem',
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: '4px',
        lineHeight: 1.0,
        width: '100%',
        maxWidth: 130,
        marginLeft: 'auto',
        marginRight: 'auto'
      }}
    >
      <span
        className="donation-label"
        style={{ fontSize: '12px', cursor: 'pointer', opacity: 0.6, transition: 'opacity 0.3s ease', display: 'inline-block', textAlign: 'left' }}
        onClick={() => window.open(linkUrl, '_blank', 'noopener,noreferrer')}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.6'; }}
      >
        {label}
      </span>
      <span
        className="donation-address"
        onClick={() => handleCopy(address)}
        style={{
          fontSize: '12px',
          display: 'inline-block',
          cursor: 'pointer',
          transition: 'all 0.3s ease'
        }}
      >
        {shorten(address)}
      </span>
    </div>
  );

  return (
    <div className="donation-container" style={{ textAlign: 'center' }}>
      <div className="donation-title" onClick={() => setOpen(true)} style={{ cursor: 'pointer', marginBottom: '0.05rem' }}>
        DONATION
      </div>
      <Row label="FAUCET" address={FAUCET_ADDRESS} linkUrl={FAUCET_URL} />
      <Row label="LOGICSIG" address={LOGICSIG_ADDRESS} linkUrl={LOGICSIG_URL} />
      <Row label="CREATOR" address={CREATOR_ADDRESS} linkUrl={CREATOR_URL} />

      {open && typeof window !== 'undefined' && createPortal(
        <div data-modal-root="true" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 24000, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: 'translateZ(0)', willChange: 'transform' }}>
          <div style={{ background: 'rgba(255, 255, 255, 0)', border: '2px solid #FFFFFF', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', borderRadius: 20, padding: 20, width: '95%', maxWidth: 600, color: 'white', boxSizing: 'border-box', overflowX: 'hidden', backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, position: 'relative' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  className="mini-pill"
                  onClick={() => smoothSwitchTab('donate')}
                  style={{
                    width: 36,
                    height: 36,
                    minWidth: 36,
                    minHeight: 36,
                    border: '2px solid #FFFFFF',
                    borderRadius: 50,
                    backgroundColor: activeTab === 'donate' ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)',
                    color: 'white',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                    boxSizing: 'border-box'
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 5v14" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                    <path d="M5 12h14" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </button>
                <button
                  className="mini-pill"
                  onClick={() => smoothSwitchTab('top')}
                  style={{
                    width: 36,
                    height: 36,
                    minWidth: 36,
                    minHeight: 36,
                    border: '2px solid #FFFFFF',
                    borderRadius: 50,
                    backgroundColor: activeTab === 'top' ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)',
                    color: 'white',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                    boxSizing: 'border-box'
                  }}
                >
                  <img src="/icon_trophy.png" alt="trophy" width="16" height="16" />
                </button>
              </div>

              {/* Centered title in absolute position */}
              <div style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                fontSize: 16,
                fontWeight: 'bold',
                color: 'white'
              }}>
                {activeTab === 'donate' ? 'Donate' : 'Top Donation'}
              </div>

              <button
                className="mini-pill"
                onClick={() => setOpen(false)}
                style={{ width: 36, height: 36, minWidth: 36, minHeight: 36, border: '2px solid #FFFFFF', borderRadius: 50, backgroundColor: 'rgba(255,255,255,0.1)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxSizing: 'border-box' }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="16" height="16">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div ref={contentRef} className="hidden-scrollbar" style={{ height: 480, overflowY: 'auto', paddingRight: 0, paddingBottom: 20, opacity: contentOpacity, transition: 'opacity 0.2s ease' }}>
              {activeTab === 'donate' && (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'center', alignItems: 'center' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 24, width: '100%', maxWidth: '400px', padding: '0 20px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)' }}>
                        <span style={{ fontSize: 14, opacity: 0.8 }}>Your Balance:</span>
                        <span style={{ fontSize: 14, fontWeight: 'bold' }}>{userBalance != null ? userBalance.toFixed(6) : '—'} ALGO</span>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)' }}>
                        <span style={{ fontSize: 14, opacity: 0.8 }}>MBR:</span>
                        <span style={{ fontSize: 14, fontWeight: 'bold' }}>{userMBR != null ? userMBR.toFixed(6) : '—'} ALGO</span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', width: '100%' }}>
                      <input
                        type="number"
                        inputMode="decimal"
                        step="1"
                        min="0"
                        value={donationAmt}
                        onChange={(e) => setDonationAmt(e.target.value)}
                        placeholder="Amount (ALGO)"
                        style={{
                          flex: 1,
                          padding: '12px 16px',
                          borderRadius: 12,
                          border: '2px solid rgba(255,255,255,0.3)',
                          background: 'rgba(0,0,0,0.2)',
                          color: 'white',
                          fontSize: 16,
                          outline: 'none',
                          boxShadow: 'none',
                          boxSizing: 'border-box'
                        }}
                      />
                      <button
                        className="mini-pill"
                        style={{
                          width: 48,
                          height: 48,
                          minWidth: 48,
                          minHeight: 48,
                          borderRadius: 50,
                          border: '2px solid #FFFFFF',
                          backgroundColor: 'rgba(255,255,255,0.1)',
                          color: 'white',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          boxSizing: 'border-box',
                          opacity: sending ? 0.6 : 1,
                          cursor: sending ? 'not-allowed' : 'pointer'
                        }}
                        onClick={async () => {
                          const n = Number(donationAmt);
                          if (isFinite(n) && n > 0) {
                            await performDonate(n)
                          } else {
                            enqueueSnackbar('Invalid amount', { variant: 'error' })
                          }
                        }}
                        disabled={sending}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="20" height="20">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 8.25 21 12m0 0-3.75 3.75M21 12H3" />
                        </svg>
                      </button>
                    </div>

                    <div style={{ textAlign: 'center', fontSize: 12, opacity: 0.8 }}>Note: Donation</div>
                  </div>
                </div>
              )}

              {activeTab === 'top' && (
                <div>
                  {/* Spacer like Top Score header (as if a text was here) */}
                  <div style={{
                    marginBottom: 16,
                    padding: 12,
                    fontSize: 12,
                    textAlign: 'center',
                    color: 'white'
                  }}>
                    {/* intentionally left blank to create spacing */}
                  </div>
                  {!indexerAvailable ? (
                    <div>Indexer unavailable. Please configure VITE_INDEXER_* envs.</div>
                  ) : loadingList ? (
                    <div>Loading…</div>
                  ) : donations.length === 0 ? (
                    <div style={{ textAlign: 'center' }}>No donations found</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {donations.map((d, idx) => (
                        <div key={d.txid} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.12)', padding: '6px 0', gap: 8 }}>
                          <span style={{ fontSize: 12, opacity: 0.8, minWidth: 18, textAlign: 'right' }}>{idx + 1}.</span>
                          <span style={{ fontSize: 12, flex: 1 }}>
                            {shorten(d.sender)}{(activeAddress && d.sender === activeAddress) ? <span style={{ color: '#FFD700', marginLeft: 6 }}>[You]</span> : null}
                          </span>
                          <span style={{ fontSize: 12 }}>{(d.amountMicro / 1_000_000).toFixed(6)} ALGO</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default Donation;


