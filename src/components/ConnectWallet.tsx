import React, { useEffect, useMemo, useState } from 'react'
import { useWallet, Wallet } from '@txnlab/use-wallet-react'

const ConnectWallet: React.FC = () => {
  const { activeAddress, wallets, activeWallet, algodClient } = useWallet()

  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [balanceShort, setBalanceShort] = useState<string>('—')
  const [isCopied, setIsCopied] = useState<boolean>(false)

  const supportedWallets = useMemo(() => {
    const order = ['pera', 'defly', 'lute']
    const map: Record<string, Wallet | undefined> = {}
    for (const w of wallets || []) {
      map[w.metadata.name.toLowerCase()] = w
    }
    return order.map((id) => map[id]).filter(Boolean) as Wallet[]
  }, [wallets])

  const updateBalance = async () => {
    if (!activeAddress) return
    try {
      const info = await algodClient.accountInformation(activeAddress).do()
      const algosNum = Number(info.amount || 0) / 1_000_000
      const short = formatShortAlgo(algosNum)
      setBalanceShort(short)
    } catch (_e) {
      setBalanceShort('—')
    }
  }

  useEffect(() => {
    if (!isMenuOpen) return
    let cancelled = false
    ;(async () => {
      if (cancelled) return
      await updateBalance()
    })()
    return () => { cancelled = true }
  }, [isMenuOpen])

  useEffect(() => {
    const onRefresh = () => { updateBalance() }
    window.addEventListener('algofaucet:refresh-balance', onRefresh)
    return () => window.removeEventListener('algofaucet:refresh-balance', onRefresh)
  }, [activeAddress, algodClient])

  const truncateAddress = (address: string) => {
    if (!address) return ''
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }

  const formatShortAlgo = (algos: number): string => {
    let out: string
    if (algos >= 1_000_000_000) {
      out = (algos / 1_000_000_000).toFixed(1) + 'B'
    } else if (algos >= 1_000_000) {
      out = (algos / 1_000_000).toFixed(1) + 'M'
    } else if (algos >= 1_000) {
      out = (algos / 1_000).toFixed(1) + 'k'
    } else if (algos >= 1) {
      out = algos.toFixed(2)
    } else {
      out = algos.toFixed(3)
    }
    return out.replace(/\.0+$|(?<=\.\d*[1-9])0+$/g, '')
  }

  const connectWith = async (wallet: Wallet) => {
    try {
      await wallet.connect()
      setIsMenuOpen(false)
    } catch (_e) {}
  }

  const handleMainClick = () => {
    setIsMenuOpen((v) => !v)
    setIsCopied(false)
  }

  const copyToClipboard = async () => {
    if (!activeAddress) return
    try {
      await navigator.clipboard.writeText(activeAddress)
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 1200)
    } catch (_e) {
      setIsCopied(false)
    }
  }

  const disconnect = async () => {
    try {
      await activeWallet?.disconnect()
    } finally {
      setIsMenuOpen(false)
    }
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        data-test-id="connect-wallet"
        className="connect-wallet-button"
        onClick={handleMainClick}
        style={{
          backgroundColor: 'rgba(255, 255, 255, 0.1)',
          border: '2px solid #FFFFFF',
          borderRadius: '50px',
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backdropFilter: 'blur(8px)',
          width: '180px',
          minWidth: '180px',
          height: '36px',
          padding: '8px 16px',
          fontSize: '14px',
          boxSizing: 'border-box',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textAlign: 'center'
        }}
      >
        <span style={{ width: '100%', textAlign: 'center' }}>
          {activeAddress ? truncateAddress(activeAddress) : 'Connect wallet'}
        </span>
      </button>

      {isMenuOpen && !activeAddress && (
        <div
          style={{
            position: 'absolute',
            top: '44px',
            left: 0,
            width: '180px',
            display: 'flex',
            justifyContent: 'flex-start',
            alignItems: 'center',
            gap: '6px',
            zIndex: 1001,
          }}
        >
          {supportedWallets.map((w) => (
            <button
              key={w.metadata.name}
              onClick={() => connectWith(w)}
              style={{
                width: '56px',
                height: '36px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                border: '2px solid #FFFFFF',
                color: 'white',
                borderRadius: '50px',
                cursor: 'pointer',
                boxSizing: 'border-box'
              }}
              className="mini-pill"
            >
              <img src={`/Pera.png`} alt={w.metadata.name} style={{ width: 22, height: 22, borderRadius: '50%', display: w.metadata.name.toLowerCase()==='pera' ? 'block':'none' }} />
              <img src={`/Defly.png`} alt={w.metadata.name} style={{ width: 22, height: 22, borderRadius: '50%', display: w.metadata.name.toLowerCase()==='defly' ? 'block':'none' }} />
              <img src={`/Lute.png`} alt={w.metadata.name} style={{ width: 22, height: 22, borderRadius: '50%', display: w.metadata.name.toLowerCase()==='lute' ? 'block':'none' }} />
            </button>
          ))}
        </div>
      )}

      {isMenuOpen && activeAddress && (
        <div
          style={{
            position: 'absolute',
            top: '44px',
            left: 0,
            width: '180px',
            display: 'flex',
            justifyContent: 'flex-start',
            alignItems: 'center',
            gap: '6px',
            zIndex: 1001
          }}
        >
          <button
            style={{
              width: '56px',
              height: '36px',
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              border: '2px solid #FFFFFF',
              color: 'white',
              borderRadius: '50px',
              cursor: 'default',
              boxSizing: 'border-box',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '11px',
              fontWeight: 700
            }}
            className="mini-pill"
          >
            {balanceShort}
          </button>
          <button
            onClick={copyToClipboard}
            style={{
              width: '56px',
              height: '36px',
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              border: '2px solid #FFFFFF',
              color: 'white',
              borderRadius: '50px',
              cursor: 'pointer',
              boxSizing: 'border-box',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            className="mini-pill"
          >
            {isCopied ? (
              <span style={{ fontSize: 14, lineHeight: 1 }}>✓</span>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="9" y="9" width="10" height="10" rx="2" stroke="white" strokeWidth="2"/>
                <rect x="5" y="5" width="10" height="10" rx="2" stroke="white" strokeWidth="2"/>
              </svg>
            )}
          </button>
          <button
            onClick={disconnect}
            style={{
              width: '56px',
              height: '36px',
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              border: '2px solid #FFFFFF',
              color: 'white',
              borderRadius: '50px',
              cursor: 'pointer',
              boxSizing: 'border-box',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            className="mini-pill"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M15 7L20 12L15 17" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M20 12H9" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M13 5H7C5.89543 5 5 5.89543 5 7V17C5 18.1046 5.89543 19 7 19H13" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}

export default ConnectWallet
