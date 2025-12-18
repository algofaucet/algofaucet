import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import algosdk from 'algosdk'
import { useSnackbar } from 'notistack'
import { getAlgodConfigFromViteEnvironment } from '../utils/network/getAlgoClientConfigs'

const CONTRACT_ID = 3054946205
const CREATOR_ADDRESS = 'GKUQEBSHVTZL4FYW7XR45EKT37XYT75VJXWGGO3NMZRHDFSAHPOY2CRBLM'

type BoxInfo = {
  addr: string
  lastClaimRound: number
}

const CreatorTools: React.FC = () => {
  const { activeAddress, transactionSigner } = useWallet()
  const { enqueueSnackbar } = useSnackbar()
  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'boxes' | 'withdraw'>('boxes')
  const [contentOpacity, setContentOpacity] = useState(1)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [boxes, setBoxes] = useState<BoxInfo[]>([])
  const [loadingBoxes, setLoadingBoxes] = useState(false)
  const [totalBalance, setTotalBalance] = useState<number>(0)
  const [minBalance, setMinBalance] = useState<number>(0)
  const available = useMemo(() => Math.max(0, totalBalance - minBalance), [totalBalance, minBalance])
  const [withdrawAmt, setWithdrawAmt] = useState<string>('')


  const algodConfig = getAlgodConfigFromViteEnvironment()
  const algodClient = new algosdk.Algodv2(String(algodConfig.token), algodConfig.server, algodConfig.port)

  const shortenAddr = (a: string) => (a && a.length > 12 ? `${a.slice(0, 4)}...${a.slice(-4)}` : a)

  const decodeLastClaimRound = (boxValue: any): number => {
    try {
      // Algod returns { value: number[] } (bytes)
      const bytes = new Uint8Array(boxValue)
      if (bytes.length < 8) return 0
      const buf = Buffer.from(bytes)
      return Number(buf.readBigUInt64BE(0))
    } catch {
      return 0
    }
  }

  const pLimit = (n: number) => {
    let active = 0
    const queue: Array<() => void> = []
    const next = () => {
      active--
      const fn = queue.shift()
      if (fn) fn()
    }
    return async <T,>(fn: () => Promise<T>): Promise<T> =>
      await new Promise<T>((resolve, reject) => {
        const run = () => {
          active++
          fn().then(resolve, reject).finally(next)
        }
        if (active < n) run()
        else queue.push(run)
      })
  }

  const refreshBoxes = async () => {
    setLoadingBoxes(true)
    try {
      const res = await algodClient.getApplicationBoxes(CONTRACT_ID).do()
      const names: Uint8Array[] = []
      for (const b of res.boxes || []) {
        const nameB64 = (b as any)?.name
        if (!nameB64) continue
        try {
          const bytes = Uint8Array.from(Buffer.from(nameB64, 'base64'))
          // box name is the public key bytes of the address
          names.push(bytes)
        } catch {}
      }
      const limit = pLimit(10)
      const infos = await Promise.all(
        names.map((name) =>
          limit(async () => {
            const addr = algosdk.encodeAddress(name)
            try {
              const box = await algodClient.getApplicationBoxByName(CONTRACT_ID, name).do()
              const lastClaimRound = box?.value ? decodeLastClaimRound(box.value) : 0
              return { addr, lastClaimRound }
            } catch {
              return { addr, lastClaimRound: 0 }
            }
          }),
        ),
      )
      // Most recent at top, oldest at bottom
      infos.sort((a, b) => (b.lastClaimRound - a.lastClaimRound) || a.addr.localeCompare(b.addr))
      setBoxes(infos)
    } catch (e) {
      enqueueSnackbar('Failed to load boxes', { variant: 'error' })
    }
    setLoadingBoxes(false)
  }

  const refreshContractStats = async () => {
    try {
      const appAddr = algosdk.getApplicationAddress(CONTRACT_ID)
      const info = await algodClient.accountInformation(appAddr).do()
      const total = Number(info.amount) / 1_000_000
      const min = Number(info.minBalance) / 1_000_000
      setTotalBalance(total)
      setMinBalance(min)
      if (!withdrawAmt) setWithdrawAmt(String(Math.max(0, total - min)))
    } catch (e) {
      enqueueSnackbar('Failed to fetch contract stats', { variant: 'error' })
    }
  }

  useEffect(() => {
    if (!open) return
    if (activeTab === 'boxes') refreshBoxes()
    if (activeTab === 'withdraw') refreshContractStats()
    setContentOpacity(1)
  }, [open, activeTab])

  const smoothSwitchTab = (tab: 'boxes' | 'withdraw') => {
    if (tab === activeTab) return
    setContentOpacity(0)
    window.setTimeout(() => {
      setActiveTab(tab)
      if (contentRef.current) contentRef.current.scrollTop = 0
      window.setTimeout(() => setContentOpacity(1), 60)
    }, 160)
  }

  const performWithdraw = async (amtAlgo: number) => {
    if (!activeAddress || !transactionSigner) {
      enqueueSnackbar('Please connect your wallet first', { variant: 'error' })
      return
    }
    if (!isFinite(amtAlgo) || amtAlgo <= 0) {
      enqueueSnackbar('Invalid amount', { variant: 'error' })
      return
    }
    const amt = Math.round(amtAlgo * 1_000_000)
    const amtArg = new Uint8Array(8)
    new DataView(amtArg.buffer).setBigUint64(0, BigInt(amt))
    try {
      const sp = await algodClient.getTransactionParams().do()
      const txn = algosdk.makeApplicationCallTxnFromObject({
        sender: activeAddress,
        appIndex: CONTRACT_ID,
        onComplete: algosdk.OnApplicationComplete.NoOpOC,
        appArgs: [new TextEncoder().encode('withdraw'), amtArg],
        suggestedParams: { ...sp, flatFee: true, fee: 2000 },
      })
      const signed = await transactionSigner([txn], [0])
      const res = await algodClient.sendRawTransaction(signed).do()
      await algosdk.waitForConfirmation(algodClient, res.txid, 10)
      enqueueSnackbar('Withdraw successful', { variant: 'success' })
    } catch (e: any) {
      enqueueSnackbar(`Withdraw failed: ${e?.message || 'error'}`, { variant: 'error' })
    }
  }

  useEffect(() => {
    try {
      window.dispatchEvent(new Event(open ? 'algofaucet:modal:open' : 'algofaucet:modal:close'))
    } catch {}
  }, [open])

  const performDeleteBox = async (boxAddress: string) => {
    if (!activeAddress || !transactionSigner) {
      enqueueSnackbar('Please connect your wallet first', { variant: 'error' })
      return
    }
    if (!boxAddress) return
    try {
      const suggestedParams = await algodClient.getTransactionParams().do()
      const boxName = algosdk.decodeAddress(boxAddress).publicKey
      const txn = algosdk.makeApplicationCallTxnFromObject({
        sender: activeAddress,
        appIndex: CONTRACT_ID,
        appArgs: [new TextEncoder().encode('delete_box'), boxName],
        boxes: [{ appIndex: CONTRACT_ID, name: boxName }],
        onComplete: algosdk.OnApplicationComplete.NoOpOC,
        suggestedParams,
      })
      const signed = await transactionSigner([txn], [0])
      const res = await algodClient.sendRawTransaction(signed).do()
      await algosdk.waitForConfirmation(algodClient, res.txid, 4)
      setBoxes(prev => prev.filter(b => b.addr !== boxAddress))
      enqueueSnackbar('Box deleted successfully', { variant: 'success' })
    } catch (e: any) {
      enqueueSnackbar(`Delete failed: ${e?.message || 'error'}`, { variant: 'error' })
    }
  }

  // Only show for creator
  if (!activeAddress || activeAddress !== CREATOR_ADDRESS) {
    return null
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        className="mini-pill"
        onClick={() => setOpen(true)}
        style={{
          width: '36px',
          height: '36px',
          backgroundColor: 'rgba(255, 255, 255, 0.1)',
          border: '2px solid #FFFFFF',
          color: 'white',
          borderRadius: '50px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="16" height="16">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
        </svg>
      </button>
      {open && (
        <div data-modal-root="true" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 24000, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: 'translateZ(0)', willChange: 'transform' }}>
          <div style={{ background: 'rgba(255, 255, 255, 0)', border: '2px solid #FFFFFF', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', borderRadius: 20, padding: 20, width: '95%', maxWidth: 600, color: 'white', boxSizing: 'border-box', overflowX: 'hidden', backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, position: 'relative' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{
                  color: 'white',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  backgroundColor: 'rgba(255, 255, 255, 0)',
                  border: '2px solid #FFFFFF',
                  borderRadius: '20px',
                  padding: '6px 12px',
                  minWidth: '60px',
                  textAlign: 'center'
                }}>
                  {boxes.length} boxes
                </span>
                <button
                  className="mini-pill"
                  onClick={() => smoothSwitchTab('boxes')}
                  style={{
                    width: 36,
                    height: 36,
                    minWidth: 36,
                    minHeight: 36,
                    border: '2px solid #FFFFFF',
                    borderRadius: 50,
                    backgroundColor: activeTab === 'boxes' ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)',
                    color: 'white',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                    boxSizing: 'border-box'
                  }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="16" height="16">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                  </svg>
                </button>
                <button
                  className="mini-pill"
                  onClick={() => smoothSwitchTab('withdraw')}
                  style={{
                    width: 36,
                    height: 36,
                    minWidth: 36,
                    minHeight: 36,
                    border: '2px solid #FFFFFF',
                    borderRadius: 50,
                    backgroundColor: activeTab === 'withdraw' ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)',
                    color: 'white',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                    boxSizing: 'border-box'
                  }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="16" height="16">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 5.25 7.5 7.5 7.5-7.5m-15 6 7.5 7.5 7.5-7.5" />
                  </svg>
                </button>
              </div>

              {/* Centered title in absolute position */}
              <div className="hide-on-mobile" style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                fontSize: 16,
                fontWeight: 'bold',
                color: 'white'
              }}>
                {activeTab === 'boxes' ? 'Delete' : 'Withdraw'}
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
              {activeTab === 'boxes' && (
                loadingBoxes ? (
                  <div>Loading…</div>
                ) : boxes.length === 0 ? (
                  <div>No boxes</div>
                ) : (
                  <>
                    {boxes.map((b) => (
                      <div key={b.addr} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.12)', marginRight: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                          <span style={{ fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace', whiteSpace: 'nowrap' }}>
                            {shortenAddr(b.addr)}
                          </span>
                          <span style={{ fontSize: 12, opacity: 0.85, whiteSpace: 'nowrap' }}>
                            {b.lastClaimRound}
                          </span>
                        </div>
                        <button className="mini-pill" style={{ width: 36, height: 36, minWidth: 36, minHeight: 36, marginRight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #FFFFFF', borderRadius: 50, backgroundColor: 'rgba(255,255,255,0.1)', color: 'white', flexShrink: 0, boxSizing: 'border-box' }} onClick={() => performDeleteBox(b.addr)}>
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="14" height="14">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                          </svg>
                        </button>
                      </div>
                    ))}
                    {boxes.length > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
                        <button
                          className="mini-pill"
                          style={{ width: 36, height: 36, minWidth: 36, minHeight: 36, borderRadius: 50, border: '2px solid #FFFFFF', backgroundColor: 'rgba(255,255,255,0.1)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxSizing: 'border-box' }}
                          onClick={async () => {
                            try {
                              const res = await algodClient.getApplicationBoxes(CONTRACT_ID).do()
                              const names: Uint8Array[] = []
                              for (const b of res.boxes || []) {
                                const nameB64 = (b as any)?.name
                                if (nameB64) {
                                  try { names.push(Uint8Array.from(Buffer.from(nameB64, 'base64'))) } catch {}
                                }
                              }
                              if (names.length === 0) return
                              const chunk = <T,>(arr: T[], size: number): T[][] => { const out: T[][] = []; for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size)); return out }
                              for (const batch of chunk(names, 8)) {
                                const sp = await algodClient.getTransactionParams().do()
                                const appArgs = [new TextEncoder().encode('delete_many'), ...batch]
                                const boxesArg = batch.map((n) => ({ appIndex: CONTRACT_ID, name: n }))
                                const txn = algosdk.makeApplicationCallTxnFromObject({ sender: activeAddress as string, appIndex: CONTRACT_ID, onComplete: algosdk.OnApplicationComplete.NoOpOC, appArgs, boxes: boxesArg as any, suggestedParams: sp })
                                const signed = await transactionSigner!([txn], [0])
                                const send = await algodClient.sendRawTransaction(signed).do()
                                await algosdk.waitForConfirmation(algodClient, send.txid, 15)
                              }
                              enqueueSnackbar('All boxes deleted', { variant: 'success' })
                              refreshBoxes()
                            } catch (e: any) {
                              enqueueSnackbar(`Delete all failed: ${e?.message || 'error'}`, { variant: 'error' })
                            }
                          }}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="16" height="16">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m6 4.125 2.25 2.25m0 0 2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </>
                )
              )}

            {activeTab === 'withdraw' && (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'center', alignItems: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 24, width: '100%', maxWidth: '400px', padding: '0 20px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)' }}>
                      <span style={{ fontSize: 14, opacity: 0.8 }}>Total Balance:</span>
                      <span style={{ fontSize: 14, fontWeight: 'bold' }}>{totalBalance.toFixed(6)} ALGO</span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)' }}>
                      <span style={{ fontSize: 14, opacity: 0.8 }}>Minimum Balance:</span>
                      <span style={{ fontSize: 14, fontWeight: 'bold' }}>{minBalance.toFixed(6)} ALGO</span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', backgroundColor: 'rgba(135, 206, 250, 0.1)', borderRadius: 8, border: '1px solid rgba(135, 206, 250, 0.3)' }}>
                      <span style={{ fontSize: 14, fontWeight: 'bold', color: '#87CEFA' }}>Available for Withdrawal:</span>
                      <span style={{ fontSize: 14, fontWeight: 'bold', color: '#87CEFA' }}>{available.toFixed(6)} ALGO</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', width: '100%' }}>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="1"
                      min="0"
                      value={withdrawAmt}
                      onChange={(e) => setWithdrawAmt(e.target.value)}
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
                        cursor: 'pointer'
                      }}
                      onClick={async () => {
                        const n = Number(withdrawAmt || available);
                        if (isFinite(n) && n > 0) {
                          await performWithdraw(n);
                          refreshContractStats()
                        } else {
                          enqueueSnackbar('Invalid amount', { variant: 'error' })
                        }
                      }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="20" height="20">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 5.25 7.5 7.5 7.5-7.5m-15 6 7.5 7.5 7.5-7.5" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default CreatorTools


