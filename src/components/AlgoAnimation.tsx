import React, { useState, useEffect, useRef } from 'react';

interface AlgoParticle {
  id: number;
  x: number;
  y: number;
  createdAt: number;
}

const AlgoAnimation: React.FC = () => {
  const [particles, setParticles] = useState<AlgoParticle[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [interactionCount, setInteractionCount] = useState(0);
  // Permet de ne déclencher l'annonce via les clics qu'une seule fois
  const hasTriggeredAfterClicksRef = useRef(false);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (!enabled) return;
      if (modalOpen) return;
      const target = e.target as HTMLElement | null;
      if (target && target.closest && target.closest('[data-modal-root="true"]')) return;
      const newParticle: AlgoParticle = {
        id: Date.now(),
        x: e.clientX,
        y: e.clientY,
        createdAt: Date.now(),
      };
      setParticles(prev => [...prev, newParticle]);
      setInteractionCount(prev => prev + 1);
    };

    document.addEventListener('click', handleClick);

    return () => {
      document.removeEventListener('click', handleClick);
    };
  }, []);

  useEffect(() => {
    const onOpen = () => setModalOpen(true)
    const onClose = () => setModalOpen(false)
    window.addEventListener('algofaucet:modal:open', onOpen)
    window.addEventListener('algofaucet:modal:close', onClose)
    return () => {
      window.removeEventListener('algofaucet:modal:open', onOpen)
      window.removeEventListener('algofaucet:modal:close', onClose)
    }
  }, [])

  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      setParticles(prev => prev.filter(particle => now - particle.createdAt < 2000));
    }, 100);

    return () => {
      clearInterval(cleanupInterval);
    };
  }, []);

  useEffect(() => {
    const onDisable = () => setEnabled(false)
    const onEnable = () => setEnabled(true)
    window.addEventListener('algofaucet:animation:disable', onDisable)
    window.addEventListener('algofaucet:animation:enable', onEnable)
    return () => {
      window.removeEventListener('algofaucet:animation:disable', onDisable)
      window.removeEventListener('algofaucet:animation:enable', onEnable)
    }
  }, [])

  // Émettre un événement quand on atteint 5 interactions (une seule fois)
  useEffect(() => {
    if (interactionCount >= 5 && !hasTriggeredAfterClicksRef.current) {
      hasTriggeredAfterClicksRef.current = true;
      // Ad banner removed
    }
  }, [interactionCount])

  // Remettre le compteur de clics à 0 quand l'annonce est fermée
  useEffect(() => {
    const handleAdClosed = () => {
      setInteractionCount(0);
    };

    window.addEventListener('algofaucet:ad-closed', handleAdClosed);

    return () => {
      window.removeEventListener('algofaucet:ad-closed', handleAdClosed);
    };
  }, [])

  return (
    <>
      {enabled && particles.map(particle => (
        <img
          key={particle.id}
          src="/algo.png"
          alt="Algo"
          className="algo-particle"
          style={{
            position: 'fixed',
            left: particle.x - 15,
            top: particle.y - 15,
            zIndex: 30001,
            pointerEvents: 'none'
          }}
        />
      ))}
    </>
  );
};

export default AlgoAnimation;
