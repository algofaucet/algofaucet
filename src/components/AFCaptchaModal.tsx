import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type Tile = number // 0 = empty, 1..8 tiles

const SOLVED_STATE = '123456780'
const MAX_MOVES = 4

// Must match `afcaptcha_contract.py` BASE_STATES_STR ordering (30 * 9 chars)
const BASE_STATES: string[] = [
  '123450786',
  '123456708',
  '120453786',
  '123405786',
  '123406758',
  '123456078',
  '102453786',
  '103425786',
  '103426758',
  '123045786',
  '123046758',
  '123056478',
  '123460758',
  '123485706',
  '012453786',
  '013425786',
  '013426758',
  '023145786',
  '023146758',
  '023156478',
  '120463758',
  '123468750',
  '123485076',
  '123485760',
  '123506478',
  '123745086',
  '123746058',
  '130425786',
  '130426758',
  '152403786',
]

function stringToTiles(state: string): Tile[] {
  return state.split('').map((c) => Number(c))
}

function tilesToString(tiles: Tile[]): string {
  return tiles.map(String).join('')
}

function neighbors(i: number): number[] {
  const row = Math.floor(i / 3)
  const col = i % 3
  const out: number[] = []
  if (row > 0) out.push(i - 3)
  if (row < 2) out.push(i + 3)
  if (col > 0) out.push(i - 1)
  if (col < 2) out.push(i + 1)
  return out
}

export type AFCaptchaSolvePayload = {
  idx: number
  roundRef: number
  initialState: string
  movesAscii: string
}

type Props = {
  open: boolean
  roundRef: number
  initialState: string
  idx: number
  onRequestClose: () => void
  onSolveAndClaim: (payload: AFCaptchaSolvePayload) => Promise<void>
}

const AFCaptchaModal: React.FC<Props> = ({ open, roundRef, initialState, idx, onRequestClose, onSolveAndClaim }) => {
  const [tiles, setTiles] = useState<Tile[]>(stringToTiles(initialState || BASE_STATES[0]))
  const [moves, setMoves] = useState<number[]>([])
  const [submitting, setSubmitting] = useState(false)
  const mountedRef = useRef(false)

  // Initialize puzzle from props (derived from Block.seed(round_ref) off-chain).
  useEffect(() => {
    if (!open) return
    setTiles(stringToTiles(initialState || BASE_STATES[0]))
    setMoves([])
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [open, initialState])

  const isSolved = useMemo(() => tilesToString(tiles) === SOLVED_STATE, [tiles])
  const movesAscii = useMemo(() => moves.join(''), [moves])
  const movesRemaining = MAX_MOVES - moves.length

  const moveTile = (tileIdx: number) => {
    if (!open || submitting) return
    if (moves.length >= MAX_MOVES) return
    const empty = tiles.indexOf(0)
    const can = neighbors(empty).includes(tileIdx)
    if (!can) return
    const next = [...tiles]
    const tileMoved = tiles[tileIdx] // 1..8
    ;[next[empty], next[tileIdx]] = [next[tileIdx], next[empty]]
    setTiles(next)
    setMoves((m) => [...m, tileMoved])
  }

  const submit = async () => {
    if (submitting) return
    if (!isSolved) {
      return
    }
    if (moves.length < 1 || moves.length > MAX_MOVES) {
      return
    }
    if (!roundRef || !initialState) {
      return
    }
    setSubmitting(true)
    try {
      await onSolveAndClaim({
        idx,
        roundRef,
        initialState: BASE_STATES[idx],
        movesAscii,
      })
      if (mountedRef.current) onRequestClose()
    } catch (e: any) {
      // errors are handled elsewhere (snackbar / global UI)
    } finally {
      if (mountedRef.current) setSubmitting(false)
    }
  }

  if (!open) return null

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 24000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transform: 'translateZ(0)',
        willChange: 'transform',
      }}
      onClick={onRequestClose}
    >
      <div
        style={{
          background: 'rgba(255, 255, 255, 0)',
          border: '2px solid #FFFFFF',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          borderRadius: 20,
          padding: 20,
          width: '95%',
          maxWidth: 600,
          color: 'white',
          boxSizing: 'border-box',
          overflowX: 'hidden',
          backfaceVisibility: 'hidden',
          WebkitBackfaceVisibility: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, position: 'relative' }}>
          <div style={{ width: 36, height: 36 }} />

          <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', fontSize: 16, fontWeight: 600, color: 'white', pointerEvents: 'none' }}>
            AFCaptcha
          </div>

          <button
            className="mini-pill"
            onClick={onRequestClose}
            style={{
              width: 36,
              height: 36,
              border: '2px solid #FFFFFF',
              borderRadius: 50,
              backgroundColor: 'rgba(255,255,255,0.1)',
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: submitting ? 'not-allowed' : 'pointer',
              opacity: submitting ? 0.6 : 1,
            }}
            disabled={submitting}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="16" height="16">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div
          className="hidden-scrollbar"
          style={{
            height: 480,
            overflowY: 'auto',
            paddingBottom: 20,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12, fontSize: 12, opacity: 0.9 }}>
            <span style={{ marginRight: 10 }}>Moves: {moves.length}/{MAX_MOVES}</span>
            <span style={{ opacity: 0.8 }}>Remaining: {movesRemaining}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 80px)', gap: 6, justifyContent: 'center' }}>
            {tiles.map((v, i) => (
              <button
                key={i}
                onClick={() => moveTile(i)}
                disabled={submitting}
                style={{
                  width: 80,
                  height: 80,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '2px solid #FFFFFF',
                  borderRadius: 12,
                  backgroundColor: v === 0 ? 'transparent' : 'rgba(255,255,255,0.15)',
                  color: 'white',
                  fontSize: 22,
                  cursor: submitting ? 'not-allowed' : (v === 0 ? 'default' : 'pointer'),
                  opacity: submitting ? 0.7 : 1,
                }}
              >
                {v !== 0 ? v : ''}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
            <button
              className="mini-pill"
              onClick={submit}
              disabled={submitting || !isSolved}
              style={{
                width: 160,
                height: 36,
                border: '2px solid #FFFFFF',
                borderRadius: 50,
                backgroundColor: 'rgba(255,255,255,0.1)',
                color: 'white',
                cursor: submitting || !isSolved ? 'not-allowed' : 'pointer',
                opacity: submitting || !isSolved ? 0.6 : 1,
                transition: 'all 0.25s ease',
                boxShadow: 'none',
              }}
            >
              {submitting ? 'Verifying…' : 'Verify & Claim'}
            </button>
          </div>

          <div style={{ marginTop: 12, textAlign: 'center', fontSize: 11, opacity: 0.85, lineHeight: 1.3 }}>
            <div style={{ marginTop: 4, minHeight: 14, color: '#FFD700', opacity: 1 }}>
              moves: {movesAscii}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default AFCaptchaModal


