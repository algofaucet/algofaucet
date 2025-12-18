import React, { useState, useEffect } from 'react';

// Clé de stockage pour compter le nombre total d'affichages de la pub
const AD_SHOWN_KEY = 'algofaucet:ad-shown-count';

const AdBanner: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);
  const [isClosed, setIsClosed] = useState(false);
  const [isPuzzleModalOpen, setIsPuzzleModalOpen] = useState(false);
  const [shownCount, setShownCount] = useState<number>(0);

  // Lecture initiale du nombre d'affichages déjà effectués
  useEffect(() => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(AD_SHOWN_KEY) : null;
      const parsed = raw != null ? parseInt(raw, 10) : 0;
      const safeCount = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
      setShownCount(safeCount);

      // Affichage automatique à l'arrivée sur le site (1ère fois seulement)
      if (safeCount < 1) {
        setIsVisible(true);
        const next = safeCount + 1;
        setShownCount(next);
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(AD_SHOWN_KEY, String(next));
        }
      }
    } catch {
      // En cas d'erreur de localStorage, ne rien casser : on n'affiche que pour cette session.
      if (shownCount < 1) {
        setIsVisible(true);
        setShownCount(1);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fonction utilitaire pour afficher la pub en respectant la limite globale
  const showAdIfAllowed = () => {
    if (shownCount >= 2) return; // Déjà affichée 2 fois : ne plus jamais afficher
    if (isClosed || isPuzzleModalOpen) return;

    setIsVisible(true);
    const next = shownCount + 1;
    setShownCount(next);
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(AD_SHOWN_KEY, String(next));
      }
    } catch {
      // ignore storage errors
    }
  };

  useEffect(() => {
    const handleShowAd = () => {
      // Ne réagir aux événements 'show-ad' que si on n'a pas déjà atteint 2 affichages
      showAdIfAllowed();
    };

    const handlePuzzleModalOpen = () => {
      setIsPuzzleModalOpen(true);
      setIsVisible(false); // Masquer l'annonce quand le puzzle s'ouvre
    };

    const handlePuzzleModalClose = () => {
      setIsPuzzleModalOpen(false);
    };

    window.addEventListener('algofaucet:show-ad', handleShowAd);
    window.addEventListener('algofaucet:puzzle:open', handlePuzzleModalOpen);
    window.addEventListener('algofaucet:puzzle:close', handlePuzzleModalClose);

    return () => {
      window.removeEventListener('algofaucet:show-ad', handleShowAd);
      window.removeEventListener('algofaucet:puzzle:open', handlePuzzleModalOpen);
      window.removeEventListener('algofaucet:puzzle:close', handlePuzzleModalClose);
    };
  }, [isClosed, isPuzzleModalOpen, shownCount]);

  const handleClose = () => {
    setIsVisible(false);
    setIsClosed(true);
    // Émettre un événement pour remettre le compteur de clics à 0 côté animation
    window.dispatchEvent(new CustomEvent('algofaucet:ad-closed'));
    // On ne remet plus isClosed à false tout de suite : la remontée
    // d'une nouvelle annonce est entièrement contrôlée par shownCount (max 2).
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div
      id="ad-banner-modal"
      onClick={handleBackdropClick}
      style={{
        width: '100%',
        margin: 'auto',
        background: 'rgba(255, 255, 255, 0.1)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 99998,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        boxSizing: 'border-box',
        cursor: 'pointer'
      }}
    >
      <div
        style={{
          position: 'relative',
          width: '250px',
          height: '250px',
          cursor: 'default'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <iframe
          data-aa='2409433'
          src='https://acceptable.a-ads.com/2409433/?size=250x250'
          style={{
            border: '0',
            padding: '0',
            width: '250px',
            height: '250px',
            overflow: 'hidden',
            display: 'block'
          }}
          title="Publicité"
          allow="autoplay; fullscreen"
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        />
      </div>
    </div>
  );
};

export default AdBanner;

