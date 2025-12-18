import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useWallet } from '@txnlab/use-wallet-react'
import algosdk from 'algosdk'
import { useSnackbar } from 'notistack'
import { getAlgodConfigFromViteEnvironment, getIndexerConfigFromViteEnvironment } from '../utils/network/getAlgoClientConfigs'

// Smart Contract AlgoPuzzle Mainnet
const ALGOPUZZLE_APP_ID = 3196312587
const ENTRY_FEE = 2000 // 0.002 ALGO en microAlgos

type Tile = number // 0 = empty, 1..8 tiles

const goal: Tile[] = [1,2,3,4,5,6,7,8,0]

const PuzzleButton: React.FC = () => {
  const [open, setOpen] = useState(false)
  const [tiles, setTiles] = useState<Tile[]>(goal)
  const [moves, setMoves] = useState<number[]>([])
  const [seconds, setSeconds] = useState(0)
  const [running, setRunning] = useState(false)
  const [currentRound, setCurrentRound] = useState<number>(0)
  const timerRef = useRef<number | null>(null)
  const [activeTab, setActiveTab] = useState<'game'|'scores'>('game')
  const [scores, setScores] = useState<{score:number;player:string;round:number;txid:string}[]>([])
  const [scoresLoading, setScoresLoading] = useState<boolean>(false)
  const [gameInfo, setGameInfo] = useState<{active:boolean;prizePool:number;bestScore:number;bestPlayer:string;gameStartRound:number}>({active:false,prizePool:0,bestScore:0,bestPlayer:'',gameStartRound:0})
  const [scoreSubmitted, setScoreSubmitted] = useState<boolean>(false)
  const [isPrizeHovered, setIsPrizeHovered] = useState<boolean>(false)
  const [isPuzzleButtonHovered, setIsPuzzleButtonHovered] = useState<boolean>(false)
  const [puzzleClickCount, setPuzzleClickCount] = useState<number>(0)
  const [submitBlinking, setSubmitBlinking] = useState<boolean>(false)
  const [newGameBlinking, setNewGameBlinking] = useState<boolean>(false)
  const [prizeClickCount, setPrizeClickCount] = useState<number>(0)
  const [showPrizeModal, setShowPrizeModal] = useState<boolean>(false)
  const [customAmount, setCustomAmount] = useState<string>('1')
  const [isUpdatingPrize, setIsUpdatingPrize] = useState<boolean>(false)

  const { activeAddress, transactionSigner } = useWallet()
  const { enqueueSnackbar } = useSnackbar()

  const algodClient = useMemo(() => {
    const cfg = getAlgodConfigFromViteEnvironment();
    return new algosdk.Algodv2(String(cfg.token), cfg.server, cfg.port);
  }, [])

  const indexer = useMemo(() => {
    try {
      const cfg = getIndexerConfigFromViteEnvironment();
      return new algosdk.Indexer(String(cfg.token as any), cfg.server, cfg.port);
    } catch { return null }
  }, [])

  // Get current round
  const fetchCurrentRound = async () => {
    try {
      const status = await algodClient.status().do()
      const round = status.lastRound || status['last-round']
      // Convertir BigInt en Number
      setCurrentRound(typeof round === 'bigint' ? Number(round) : round)
    } catch (e) {
      console.error('Erreur lors de la récupération du round:', e)
      // In case of error, use a default round
      setCurrentRound(100000000) // Round Mainnet approximatif
    }
  }

  // Get game information from smart contract
  const fetchGameInfo = async () => {
    try {
      const appInfo = await algodClient.getApplicationByID(ALGOPUZZLE_APP_ID).do()

      // Try different ways to access data
      let globalState = []
      if (appInfo.params['global-state']) {
        globalState = appInfo.params['global-state']
      } else if (appInfo.params.globalState) {
        globalState = appInfo.params.globalState
      } else if (appInfo.globalState) {
        globalState = appInfo.globalState
      }

      let active = false
      let prizePool = 0
      let bestScore = 0
      let bestPlayer = ''
      let gameStartRound = 0

      for (const item of globalState) {
        try {
          const key = Buffer.from(item.key, 'base64').toString()
          const value = item.value

          switch (key) {
            case 'game_active':
              // Handle BigInt values
              const activeValue = typeof value.uint === 'bigint' ? Number(value.uint) : value.uint
              active = activeValue === 1
              break
            case 'prize_pool':
              prizePool = typeof value.uint === 'bigint' ? Number(value.uint) : value.uint
              break
            case 'best_score':
              bestScore = typeof value.uint === 'bigint' ? Number(value.uint) : value.uint
              break
            case 'best_player':
              if (value.bytes) {
                bestPlayer = algosdk.encodeAddress(Buffer.from(value.bytes, 'base64'))
              }
              break
            case 'game_start':
              gameStartRound = typeof value.uint === 'bigint' ? Number(value.uint) : value.uint
              break
          }
        } catch (itemError) {
          console.error('Error processing state item:', itemError, item)
        }
      }

      setGameInfo({ active, prizePool, bestScore, bestPlayer, gameStartRound })
    } catch (e) {
      console.error('Erreur lors de la récupération des infos du jeu:', e)
    }
  }

  const shuffle = () => {
    // Fisher-Yates then ensure solvable
    const arr = [...goal]
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    const inv = inversions(arr.filter(n=>n!==0))
    if (inv % 2 === 1) {
      // swap two non-zero tiles to change parity
      const i = arr.findIndex(n=>n!==0)
      const j = arr.findIndex((n,idx)=>n!==0 && idx!==i)
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    setTiles(arr)
    setMoves([])
    setSeconds(0)
    setRunning(true)
    setScoreSubmitted(false)
    fetchCurrentRound()
  }

  const inversions = (a:number[]) => {
    let inv = 0
    for (let i=0;i<a.length;i++) for (let j=i+1;j<a.length;j++) if (a[i] > a[j]) inv++
    return inv
  }



  useEffect(() => {
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null }
    if (open && running) {
      timerRef.current = window.setInterval(() => setSeconds(s => s + 1), 1000)
    }
    return () => { if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null } }
  }, [open, running])

  useEffect(() => {
    const updateBlocksRemaining = async () => {
      if (open && activeTab === 'scores') {
        await fetchCurrentRound();
        await fetchGameInfo();
      }
    };

    updateBlocksRemaining();
    if (!open || activeTab !== 'scores') return;

    const interval = setInterval(updateBlocksRemaining, 3000);
    return () => clearInterval(interval);
  }, [open, activeTab]);

  const isSolved = useMemo(() => tiles.every((v,i) => v === goal[i]), [tiles])

  // Blinking animation for Submit button when puzzle is solved
  useEffect(() => {
    if (isSolved && !scoreSubmitted && gameInfo.active) {
      setSubmitBlinking(true)
      const interval = setInterval(() => {
        setSubmitBlinking(prev => !prev)
      }, 800) // Blinks every 800ms
      return () => clearInterval(interval)
    } else {
      setSubmitBlinking(false)
    }
  }, [isSolved, scoreSubmitted, gameInfo.active])

  // Blinking animation for New Game button when game is finished
  useEffect(() => {
    if (gameInfo.active && (currentRound - gameInfo.gameStartRound) >= 30000) {
      setNewGameBlinking(true)
      const interval = setInterval(() => {
        setNewGameBlinking(prev => !prev)
      }, 800) // Blinks every 800ms
      return () => clearInterval(interval)
    } else {
      setNewGameBlinking(false)
    }
  }, [gameInfo.active, currentRound, gameInfo.gameStartRound])

  useEffect(() => {
    if (isSolved && running) {
      setRunning(false)
      if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null }
      const score = moves.length + seconds
      enqueueSnackbar(`Solved! Score: ${score}`, { variant: 'success' })
    }
  }, [isSolved, running])

  const moveTile = (idx: number) => {
    if (!running) return
    const empty = tiles.indexOf(0)
    const can = neighbors(empty).includes(idx)
    if (!can) return
    const next = [...tiles]
  const tileMoved = tiles[idx] // record the tile value (1..8) the player clicked
  ;[next[empty], next[idx]] = [next[idx], next[empty]]
    setTiles(next)
  setMoves(m => [...m, tileMoved])
  }

  const neighbors = (i: number): number[] => {
    const row = Math.floor(i/3), col = i%3
    const out: number[] = []
    if (row>0) out.push(i-3)
    if (row<2) out.push(i+3)
    if (col>0) out.push(i-1)
    if (col<2) out.push(i+1)
    return out
  }

  const submitScore = async () => {
    if (!activeAddress || !transactionSigner) {
      enqueueSnackbar('Connect wallet', { variant: 'error' });
      return
    }

    if (!currentRound || currentRound === 0) {
      enqueueSnackbar('Round not available, please try again', { variant: 'error' });
      return
    }

    if (scoreSubmitted) {
      enqueueSnackbar('Score already submitted for this game!', { variant: 'warning' });
      return
    }

    try {
      enqueueSnackbar('Submitting score...', { variant: 'info' })

      const sp = await algodClient.getTransactionParams().do()
      const score = moves.length + seconds
      const movesStr = moves.join('')


      // Transaction 1: Entry fee payment to contract
      const contractAddress = algosdk.getApplicationAddress(ALGOPUZZLE_APP_ID)
      const paymentTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: activeAddress,
        receiver: contractAddress,
        amount: ENTRY_FEE,
        note: new TextEncoder().encode('AlgoPuzzle Entry Fee'),
        suggestedParams: sp
      })

      // Transaction 2: Appel d'application pour soumettre le score
      const appCallTxn = algosdk.makeApplicationCallTxnFromObject({
        sender: activeAddress,
        appIndex: ALGOPUZZLE_APP_ID,
        onComplete: algosdk.OnApplicationComplete.NoOpOC,
        appArgs: [
          new TextEncoder().encode('submit_score'),
          new TextEncoder().encode(currentRound.toString()), // ✅ ROUND (encoded string) - like in Python script
          new TextEncoder().encode(movesStr),               // ✅ Moves (encoded string)
          algosdk.encodeUint64(seconds)                    // ✅ Time (encoded uint64) - like in Python script
        ],
        note: new TextEncoder().encode('AlgoPuzzle Submit'),
        suggestedParams: sp
      })

      const groupId = algosdk.computeGroupID([paymentTxn, appCallTxn])
      paymentTxn.group = groupId
      appCallTxn.group = groupId

      const signedTxs = await transactionSigner([paymentTxn, appCallTxn], [0, 1])

                  await algodClient.sendRawTransaction(signedTxs).do()

                  // Simplified success notification
      enqueueSnackbar(`Score submitted! Score: ${score}`, { variant: 'success' })

      // Mark score as submitted and reset game
      setScoreSubmitted(true)
      setRunning(false)
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null
      }

      // Enable prize pool update indicator
      setIsUpdatingPrize(true)

      // Refresh game information immediately and after confirmation
      fetchGameInfo()
      if (activeTab === 'scores') fetchScores()

      // Refresh multiple times to ensure data is up to date
      setTimeout(() => {
        fetchGameInfo()
        if (activeTab === 'scores') fetchScores()
      }, 1500)

      setTimeout(() => {
        fetchGameInfo()
        if (activeTab === 'scores') fetchScores()
      }, 3000)

      setTimeout(() => {
        fetchGameInfo()
        if (activeTab === 'scores') fetchScores()
        setIsUpdatingPrize(false) // Disable indicator after last update
      }, 5000)

    } catch (e: any) {
      enqueueSnackbar(e?.message || 'Failed to submit score', { variant: 'error' })
    }
  }

  const handlePrizeButtonClick = () => {
    // Detect if it's a mobile device (no hover)
    const isMobile = !window.matchMedia('(hover: hover)').matches

    if (isMobile) {
      // On mobile, require two clicks
      if (prizeClickCount === 0) {
        setPrizeClickCount(1)
        // Reset after 3 seconds
        setTimeout(() => setPrizeClickCount(0), 3000)
      } else if (prizeClickCount === 1) {
        setPrizeClickCount(0)
        setShowPrizeModal(true)
      }
    } else {
      setShowPrizeModal(true)
    }
  }

  const handlePrizeModalSubmit = () => {
    const amount = parseFloat(customAmount)
    if (isNaN(amount) || amount <= 0) {
      enqueueSnackbar('Please enter a valid amount', { variant: 'error' })
      return
    }
    setShowPrizeModal(false)
    addToPrizePool(amount)
  }

  const addToPrizePool = async (amount?: number) => {
    if (!activeAddress || !transactionSigner) {
      enqueueSnackbar('Connect wallet', { variant: 'error' });
      return
    }

    try {
      enqueueSnackbar('Adding to prize pool...', { variant: 'info' })

      const sp = await algodClient.getTransactionParams().do()
      const contractAddress = algosdk.getApplicationAddress(ALGOPUZZLE_APP_ID)

      // Amount to add (default 1 ALGO, or custom amount)
      const amountToAdd = amount ? amount * 1000000 : 1000000

      const paymentTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: activeAddress,
        receiver: contractAddress,
        amount: amountToAdd,
        note: new TextEncoder().encode('AlgoPuzzle Prize'),
        suggestedParams: sp
      })

      const appCallTxn = algosdk.makeApplicationCallTxnFromObject({
        sender: activeAddress,
        appIndex: ALGOPUZZLE_APP_ID,
        onComplete: algosdk.OnApplicationComplete.NoOpOC,
        appArgs: [
          new TextEncoder().encode('add_prize')
        ],
        note: new TextEncoder().encode('AlgoPuzzle Add to Prize Pool'),
        suggestedParams: sp
      })

      const groupId = algosdk.computeGroupID([paymentTxn, appCallTxn])
      paymentTxn.group = groupId
      appCallTxn.group = groupId

      const signedTxs = await transactionSigner([paymentTxn, appCallTxn], [0, 1])

      await algodClient.sendRawTransaction(signedTxs).do()

      enqueueSnackbar(`Contribution added to prize pool!`, { variant: 'success' })

      // Enable prize pool update indicator
      setIsUpdatingPrize(true)

      // Refresh game information immediately and after confirmation
      fetchGameInfo()

      // Refresh multiple times to ensure data is up to date
      setTimeout(() => {
        fetchGameInfo()
      }, 1500)

      setTimeout(() => {
        fetchGameInfo()
      }, 3000)

      setTimeout(() => {
        fetchGameInfo()
        setIsUpdatingPrize(false) // Disable indicator after last update
      }, 5000)

    } catch (e: any) {
      console.error('Erreur ajout prize pool:', e)
      enqueueSnackbar(e?.message || 'Failed to add to prize pool', { variant: 'error' })
    }
  }

  const fetchScores = async () => {
    if (!indexer) {
      return
    }

    try {
      setScoresLoading(true)

      // Get application transactions
      const res = await (indexer as any).searchForTransactions()
        .applicationID(ALGOPUZZLE_APP_ID)
        .txType('appl')
        .limit(200)
        .do()


            const txs: any[] = res?.transactions || []


      const parsed = txs.map((t) => {
        try {
          // Check if it's a submit_score
          if (t.applicationTransaction?.applicationArgs?.[0]) {
            const arg0 = Buffer.from(t.applicationTransaction.applicationArgs[0], 'base64').toString()
                        if (arg0 === 'submit_score') {
                                                        // Parse round correctly - it's stored as ASCII string
              const roundBytes = Buffer.from(t.applicationTransaction.applicationArgs[1], 'base64')
              const roundString = roundBytes.toString('ascii')
              const round = parseInt(roundString)


              const movesStr = Buffer.from(t.applicationTransaction.applicationArgs[2], 'base64').toString()


              const timeRaw = Buffer.from(t.applicationTransaction.applicationArgs[3], 'base64')
              let time = 0
              for (let i = timeRaw.length - 1; i >= 0; i--) {
                if (timeRaw[i] !== 0) {
                  time = timeRaw[i]
                  break
                }
              }

              const score = movesStr.length + time

              const result = {
                score,
                player: t.sender,
                round: t['confirmed-round'] || t.confirmedRound || round, // Utiliser le round de confirmation de la transaction
                txid: t.id
              }
              return result
            }
          }
          return null
        } catch (error) {
          return null
        }
      }).filter(Boolean) as {score:number;player:string;round:number;txid:string}[]

      // Score Filter
      const currentGameScores = parsed.filter(score => score.round >= gameInfo.gameStartRound)

      // Remove duplicates based on txid
      const uniqueScores = currentGameScores.filter((score, index, self) =>
        index === self.findIndex(s => s.txid === score.txid)
      )

      uniqueScores.sort((a,b) => a.score - b.score)
      setScores(uniqueScores.slice(0, 50))

    } catch (e) {
      console.error('❌ Error fetching scores:', e)
    } finally {
      setScoresLoading(false)
    }
  }

  useEffect(() => {
    if (open && activeTab==='scores') {
      fetchScores()
    }
  }, [open, activeTab])

  useEffect(() => {
    if (open) {
      fetchGameInfo()
      fetchCurrentRound()
    }
  }, [open])

  // Prevent background scroll on mobile while modal is open
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [open])

  const endGame = async () => {
    if (!activeAddress || !transactionSigner) {
      enqueueSnackbar('Connect wallet', { variant: 'error' });
      return
    }

    if (!currentRound || currentRound === 0) {
      enqueueSnackbar('Round not available, please try again', { variant: 'error' });
      return
    }

    try {
      enqueueSnackbar('New Game...', { variant: 'info' })

      const sp = await algodClient.getTransactionParams().do()

      const adjustedParams = {
        ...sp,
        fee: 2000,
        flatFee: true
      }

      // Get winner address from game info to include in transaction accounts
      const accounts = []
      if (gameInfo.bestPlayer && gameInfo.bestPlayer !== 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ') {
        accounts.push(gameInfo.bestPlayer)
      }

      const appCallTxn = algosdk.makeApplicationCallTxnFromObject({
        sender: activeAddress,
        appIndex: ALGOPUZZLE_APP_ID,
        onComplete: algosdk.OnApplicationComplete.NoOpOC,
        appArgs: [
          new TextEncoder().encode('end_game')
        ],
        accounts: accounts, // Include winner address for prize distribution
        note: new TextEncoder().encode('AlgoPuzzle New Game'),
        suggestedParams: adjustedParams // User pays 2000 µAlgos (like Python script)
      })

      const signedTx = await transactionSigner([appCallTxn], [0])
      await algodClient.sendRawTransaction(signedTx).do()

      enqueueSnackbar('New game started!', { variant: 'success' })

      // Refresh game information immediately and multiple times to ensure data is up to date
      fetchGameInfo()
      fetchCurrentRound()
      if (activeTab === 'scores') fetchScores()

      // Refresh multiple times to ensure all data is updated
      setTimeout(() => {
        fetchGameInfo()
        fetchCurrentRound()
        if (activeTab === 'scores') fetchScores()
      }, 1500)

      setTimeout(() => {
        fetchGameInfo()
        fetchCurrentRound()
        if (activeTab === 'scores') fetchScores()
      }, 3000)

      setTimeout(() => {
        fetchGameInfo()
        fetchCurrentRound()
        if (activeTab === 'scores') fetchScores()
      }, 5000)

    } catch (e: any) {
      enqueueSnackbar(e?.message || 'Failed to end game', { variant: 'error' })
    }
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => {
          const isMobile = !window.matchMedia('(hover: hover)').matches
          if (isMobile) {
            if (puzzleClickCount === 0) {
              setPuzzleClickCount(1)
              setIsPuzzleButtonHovered(true)
              setTimeout(() => { setPuzzleClickCount(0); setIsPuzzleButtonHovered(false) }, 2500)
              return
            }
            setPuzzleClickCount(0)
            setIsPuzzleButtonHovered(false)
          }
          setOpen(true); shuffle();
          try { window.dispatchEvent(new Event('algofaucet:animation:disable')); window.dispatchEvent(new Event('algofaucet:puzzle:open')); } catch {}
        }}
        onMouseEnter={() => setIsPuzzleButtonHovered(true)}
        onMouseLeave={() => setIsPuzzleButtonHovered(false)}
        style={{
          width: 36, height: 36, minWidth: 36, minHeight: 36,
          backgroundColor: isPuzzleButtonHovered ? '#191919' : 'rgba(0, 0, 0, 0)',
          border: isPuzzleButtonHovered ? '2px solid #FFD700' : '2px solid #ffffff',
          color: 'white', borderRadius: 50,
          backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer',
          zIndex: 2,
          transition: 'all 0.3s ease',
          transform: isPuzzleButtonHovered ? 'scale(1.1)' : 'scale(1)',
          boxShadow: isPuzzleButtonHovered ? '0 4px 12px rgba(255, 215, 0, 0.3)' : 'none'
        }}
      >
        <img src={isPuzzleButtonHovered ? "/icon_puzzley.png" : "/icon_puzzle.png"} alt="puzzle" width="16" height="16" />
      </button>

      {open && createPortal(
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 24000, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: 'translateZ(0)', willChange: 'transform' }}>
          <div
            style={{ background: 'rgba(255, 255, 255, 0)', border: '2px solid #FFFFFF', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', borderRadius: 20, padding: 20, width: '95%', maxWidth: 600, color: 'white', boxSizing: 'border-box', overflowX: 'hidden', backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
            onMouseEnter={() => { try { window.dispatchEvent(new Event('algofaucet:animation:disable')); } catch {} }}
            onMouseLeave={() => { try { window.dispatchEvent(new Event('algofaucet:animation:enable')); } catch {} }}
            onClick={(e)=>{ e.stopPropagation(); }}
            onTouchStart={(e)=>{ e.stopPropagation(); }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, position: 'relative' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="mini-pill" style={{ width: 36, height: 36, border: '2px solid #FFFFFF', borderRadius: 50, backgroundColor: activeTab==='game'?'rgba(255,255,255,0.2)':'rgba(255,255,255,0.1)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={()=>setActiveTab('game')}>
                <img src="/icon_puzzle.png" alt="game" width="16" height="16" />
                </button>
                <button className="mini-pill" style={{ width: 36, height: 36, border: '2px solid #FFFFFF', borderRadius: 50, backgroundColor: activeTab==='scores'?'rgba(255,255,255,0.2)':'rgba(255,255,255,0.1)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={()=>setActiveTab('scores')}>
                <img src="/icon_trophy.png" alt="scores" width="16" height="16" />
                </button>
              </div>

              {/* Centered title in absolute position */}
              <div style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                fontSize: 16,
                fontWeight: 600,
                color: 'white',
                pointerEvents: 'none'
              }}>
                {activeTab === 'game' ? 'AlgoPuzzle' : 'Top Score'}
              </div>

              <button className="mini-pill" onClick={()=>{ setOpen(false); try { window.dispatchEvent(new Event('algofaucet:animation:enable')); window.dispatchEvent(new Event('algofaucet:puzzle:close')); } catch {} }} style={{ width: 36, height: 36, border: '2px solid #FFFFFF', borderRadius: 50, backgroundColor: 'rgba(255,255,255,0.1)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="16" height="16"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
              </button>
            </div>



            {activeTab==='game' ? (
              <div style={{ height: 480, overflowY: 'auto', paddingBottom: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>

                {/* Game information - Styled buttons */}
                <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'center', gap: 8 }}>
                  <button
                    className="mini-pill"
                    style={{
                      width: 100,
                      height: 36,
                      padding: '0 12px',
                      border: '2px solid #FFFFFF',
                      borderRadius: 50,
                      backgroundColor: 'rgba(255,255,255,0.1)',
                      color: 'white',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      fontSize: 12,
                      cursor: 'pointer'
                    }}
                    onMouseEnter={() => setIsPrizeHovered(true)}
                    onMouseLeave={() => setIsPrizeHovered(false)}
                    onClick={handlePrizeButtonClick}
                  >
                    {isPrizeHovered || prizeClickCount === 1 ? (
                      <>
                        <img src="/icon_lock.png" alt="lock" width="16" height="16" />
                        add
                      </>
                    ) : (
                      <>
                        <img src="/icon_lock.png" alt="lock" width="16" height="16" />
                        {isUpdatingPrize ? (
                          <span style={{
                            animation: 'pulse 1s infinite',
                            color: '#FFD700'
                          }}>
                            {(gameInfo.prizePool / 1000000).toFixed(3)}
                          </span>
                        ) : (
                          (gameInfo.prizePool / 1000000).toFixed(3)
                        )}
                      </>
                    )}
                  </button>
                  <button
                    className="mini-pill"
                    style={{
                      width: 100,
                      height: 36,
                      padding: '0 12px',
                      border: newGameBlinking ? '2px solid #FFD700' : '2px solid #FFFFFF',
                      borderRadius: 50,
                      backgroundColor: newGameBlinking ? 'rgba(255, 215, 0, 0.2)' : (currentRound - gameInfo.gameStartRound) >= 30000 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.05)',
                      color: newGameBlinking ? '#FFD700' : (currentRound - gameInfo.gameStartRound) >= 30000 ? 'white' : 'rgba(255,255,255,0.5)',
                      cursor: (currentRound - gameInfo.gameStartRound) >= 30000 ? 'pointer' : 'not-allowed',
                      fontSize: 12,
                      transition: 'all 0.3s ease',
                      boxShadow: newGameBlinking ? '0 0 10px rgba(255, 215, 0, 0.5)' : 'none'
                    }}
                    disabled={(currentRound - gameInfo.gameStartRound) < 30000}
                    onClick={endGame}
                  >
                    New Game
                  </button>
                </div>

                <div style={{ display:'flex', justifyContent:'center', marginBottom: 12 }}>
                  <span>Score: {moves.length + seconds}</span>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 80px)', gap: 6, justifyContent:'center' }}>
                  {tiles.map((v, i) => (
                    <button key={i} onClick={()=>moveTile(i)} style={{ width:80, height:80, display:'flex', alignItems:'center', justifyContent:'center', border:'2px solid #FFFFFF', borderRadius:12, backgroundColor: v===0 ? 'transparent' : 'rgba(255,255,255,0.15)', color:'white', fontSize:22 }}>
                      {v!==0 ? v : ''}
                    </button>
                  ))}
                </div>
                <div style={{ display:'flex', gap:8, justifyContent:'center', marginTop:12 }}>
                  <button className="mini-pill" style={{ width: 100, height: 36, border:'2px solid #FFFFFF', borderRadius: 50, backgroundColor:'rgba(255,255,255,0.1)', color:'white' }} onClick={shuffle}>Shuffle</button>
                  <button
                    className="mini-pill"
                    style={{
                      width: 100,
                      height: 36,
                      border: submitBlinking ? '2px solid #FFD700' : '2px solid #FFFFFF',
                      borderRadius: 50,
                      backgroundColor: submitBlinking ? 'rgba(255, 215, 0, 0.2)' : (!isSolved || !gameInfo.active || scoreSubmitted) ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.1)',
                      color: submitBlinking ? '#FFD700' : (!isSolved || !gameInfo.active || scoreSubmitted) ? 'rgba(255,255,255,0.5)' : 'white',
                      cursor: (!isSolved || !gameInfo.active || scoreSubmitted) ? 'not-allowed' : 'pointer',
                      transition: 'all 0.3s ease',
                      boxShadow: submitBlinking ? '0 0 10px rgba(255, 215, 0, 0.5)' : 'none'
                    }}
                    disabled={!isSolved || !gameInfo.active || scoreSubmitted}
                    onClick={submitScore}
                  >
                    Submit
                  </button>
                </div>

                {/* Game Information Message */}
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  marginTop: 12,
                  fontSize: 10,
                  color: 'rgba(255, 255, 255, 0.7)',
                  textAlign: 'center',
                  lineHeight: 1.3
                }}>
                                    <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 3,
                    minHeight: 14
                  }}>
                    <img
                      src="/icon_lock.png"
                      alt="lock"
                      style={{
                        width: 12,
                        height: 12,
                        marginRight: 6,
                        verticalAlign: 'middle',
                        display: 'inline-block'
                      }}
                    />
                    <span style={{
                      lineHeight: 1.2,
                      verticalAlign: 'middle',
                      display: 'inline-block'
                    }}>Prize pool = All Entry Fees [ Submit ]</span>
                  </div>
                                                                                          <div style={{
                    textAlign: 'center',
                    marginBottom: 3
                  }}>
                    <img
                      src="/icon_trophy.png"
                      alt="trophy"
                      style={{
                        width: 12,
                        height: 12,
                        marginRight: 6,
                        verticalAlign: 'text-top'
                      }}
                    />
                    <span style={{
                      lineHeight: 1.2
                    }}>Prize is sent to the best score → New Game = Distribute the Prize and start a New Game</span>
                  </div>
                  <div style={{ fontSize: 9, color: 'rgba(255, 255, 255, 0.7)' }}>
                    Everyone can add more Algo to the Prize
                    <br />
                    <a
                      href="https://explorer.perawallet.app/application/3196312587/"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: '#FFD700',
                        textDecoration: 'none',
                        fontSize: 9,
                        fontWeight: 'bold',
                        marginTop: '4px',
                        display: 'inline-block'
                      }}
                    >
                      3196312587
                    </a>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{
                height: 480,
                overflowY:'auto',
                paddingRight: 8,
                paddingBottom: 20
              }} className="hidden-scrollbar">

                {/* Game Duration Info or Winner Display */}
                <div style={{
                  marginBottom: 16,
                  padding: 12,
                  fontSize: 12,
                  textAlign: 'center',
                  color: 'white'
                }}>
                  {Math.max(0, 30000 - (currentRound - (gameInfo.gameStartRound || 0))) > 0 ? (
                    <div>
                      <span style={{ color: 'white' }}>Game ends in </span>
                      <span style={{ fontWeight: 'bold', color: 'white' }}>
                        {Math.max(0, 30000 - (currentRound - (gameInfo.gameStartRound || 0)))}
                      </span>
                      <span style={{ color: 'white' }}> blocks</span>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                      <button
                        className="mini-pill"
                        onClick={endGame}
                        style={{
                          padding: '0 12px',
                          height: 28,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          border: newGameBlinking ? '2px solid #FFD700' : '2px solid #FFFFFF',
                          borderRadius: 50,
                          backgroundColor: newGameBlinking ? 'rgba(255, 215, 0, 0.2)' : 'rgba(255,255,255,0.1)',
                          color: newGameBlinking ? '#FFD700' : 'white',
                          transition: 'all 0.3s ease',
                          boxShadow: newGameBlinking ? '0 0 10px rgba(255, 215, 0, 0.5)' : 'none',
                          cursor: 'pointer'
                        }}
                      >
                        {(() => {
                          const hasWinner = (gameInfo.bestPlayer && gameInfo.bestPlayer !== 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ')
                          if (!hasWinner) {
                            return 'New Game'
                          }
                          const short = `${gameInfo.bestPlayer.slice(0,3)}...${gameInfo.bestPlayer.slice(-3)}`
                          const prize = (gameInfo.prizePool / 1000000).toFixed(3)
                          return `${short} won ${prize} ALGO`
                        })()}
                      </button>
                    </div>
                  )}
                </div>
                {scoresLoading ? (
                  <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.7)' }}>Loading scores...</div>
                ) : scores.length===0 ? (
                  <div style={{ textAlign: 'center' }}>No scores</div>
                ) : (
                  <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                    {scores.map((s, idx) => (
                      <div key={s.txid} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid rgba(255,255,255,0.12)', padding:'6px 0', gap: 8 }}>
                        <span style={{ fontSize: 12, opacity: 0.8, minWidth: 18, textAlign: 'right' }}>{idx + 1}.</span>
                        <span style={{ fontSize: 12, flex: 1, marginRight: 8 }}>{s.player.slice(0, 8)}...{s.player.slice(-8)}{(activeAddress && s.player === activeAddress) ? <span style={{ color: '#FFD700', marginLeft: 6 }}>[You]</span> : null}</span>
                        <span style={{ fontSize: 12, minWidth: 30, textAlign: 'right' }}>{s.score}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>, document.body)
      }

      {/* Modal to choose prize amount */}
      {showPrizeModal && createPortal(
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 99999
        }}>
          <div style={{
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            backdropFilter: 'blur(8px)',
            borderRadius: 20,
            padding: '2rem',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            width: '90%',
            maxWidth: '400px',
            color: 'white'
          }}>
            <h3 style={{
              textAlign: 'center',
              marginBottom: '1.5rem',
              fontSize: '1.2rem',
              fontWeight: '400'
            }}>
              Add to Prize Pool
            </h3>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{
                display: 'block',
                marginBottom: '0.5rem',
                fontSize: '0.9rem'
              }}>
                Amount (ALGO):
              </label>
              <input
                type="number"
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '8px',
                  border: '2px solid rgba(255, 255, 255, 0.2)',
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  color: 'white',
                  fontSize: '1rem',
                  boxSizing: 'border-box',
                  outline: 'none'
                }}
                placeholder="1"
                min="0.001"
                step="0.001"
                autoFocus
              />
            </div>

                        <div style={{
              display: 'flex',
              gap: 8,
              justifyContent: 'center'
            }}>
              <button
                className="mini-pill"
                onClick={() => setShowPrizeModal(false)}
                style={{
                  width: 100,
                  height: 36,
                  border: '2px solid #FFFFFF',
                  borderRadius: 50,
                  backgroundColor: 'rgba(255,255,255,0.1)',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: 12
                }}
              >
                Cancel
              </button>
              <button
                className="mini-pill"
                onClick={handlePrizeModalSubmit}
                style={{
                  width: 100,
                  height: 36,
                  border: '2px solid #FFFFFF',
                  borderRadius: 50,
                  backgroundColor: 'rgba(255,255,255,0.1)',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: 12
                }}
              >
                Add
              </button>
            </div>
          </div>
        </div>, document.body)
      }
    </div>
  )
}

export default PuzzleButton


