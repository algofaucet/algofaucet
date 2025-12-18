import React, { useEffect, useState } from 'react'

const ThemeToggle: React.FC = () => {
  const [isDark, setIsDark] = useState(false)

  useEffect(() => {
    try {
      const stored = localStorage.getItem('theme')
      const dark = stored === 'dark'
      setIsDark(dark)
      applyClass(dark)
    } catch {}
  }, [])

  const applyClass = (dark: boolean) => {
    const root = document.documentElement
    const body = document.body
    const url = dark ? "url('/FAUCET_DARK.webp')" : "url('/FAUCET.webp')"
    if (dark) {
      root.classList.add('dark-mode')
      body.classList.add('dark-mode')
    } else {
      root.classList.remove('dark-mode')
      body.classList.remove('dark-mode')
    }
    try {
      root.style.backgroundImage = url
      body.style.backgroundImage = url
    } catch {}
  }

  const toggle = () => {
    const next = !isDark
    setIsDark(next)
    applyClass(next)
    try { localStorage.setItem('theme', next ? 'dark' : 'light') } catch {}
  }

  return (
    <button
      className="mini-pill"
      onClick={toggle}
      style={{
        width: 36,
        height: 36,
        minWidth: 36,
        minHeight: 36,
        border: '2px solid #FFFFFF',
        borderRadius: 50,
        backgroundColor: 'rgba(255,255,255,0.1)',
        color: 'white',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
        boxSizing: 'border-box'
      }}
    >
      {isDark ? (
        // Sun icon when dark (tap to go light)
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="16" height="16">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
        </svg>
      ) : (
        // Moon icon when light (tap to go dark)
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="16" height="16">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" />
        </svg>
      )}
    </button>
  )
}

export default ThemeToggle


