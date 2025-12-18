// src/components/Home.tsx
import { useWallet } from '@txnlab/use-wallet-react'
import React, { useState, useEffect } from 'react'
import Faucet from './components/Faucet'
import algosdk from 'algosdk'
import './styles/custom.css'
import { getAlgodConfigFromViteEnvironment } from './utils/network/getAlgoClientConfigs'
import Donation from './components/Donation'
import ConnectWallet from './components/ConnectWallet'
import CreatorTools from './components/CreatorTools'
import ThemeToggle from './components/ThemeToggle'

const CONTRACT_ID = 3054946205;
const BLOCKS_BETWEEN_CLAIMS = 10000;

const Home: React.FC = () => {
  const { activeAddress } = useWallet();
  const [currentBlock, setCurrentBlock] = useState(0);
  const [lastClaimBlock, setLastClaimBlock] = useState(0);
  const [remainingBlocksText, setRemainingBlocksText] = useState('');
  const [, setModalState] = useState(false);

  useEffect(() => {
    const fetchBlockInfo = async () => {
      if (!activeAddress) {
        setLastClaimBlock(0);
        setRemainingBlocksText('Connect to Claim');
        return;
      }

      try {
        const algodConfig = getAlgodConfigFromViteEnvironment();
        const algodClient = new algosdk.Algodv2(
          String(algodConfig.token),
          algodConfig.server,
          algodConfig.port
        );

        const status = await algodClient.status().do();
        const currentRound = Number(status.lastRound);
        setCurrentBlock(currentRound);

        try {
          const senderBytes = algosdk.decodeAddress(activeAddress).publicKey;
          const response = await algodClient.getApplicationBoxes(CONTRACT_ID).do();
          const hasBox = response.boxes.some((box: any) => {
            const boxName = Buffer.from(box.name, 'base64');
            return Buffer.compare(boxName, senderBytes) === 0;
          });

          if (hasBox) {
            const boxResponse = await algodClient.getApplicationBoxByName(CONTRACT_ID, senderBytes).do();
            if (boxResponse && boxResponse.value) {
              const valueBuffer = Buffer.from(new Uint8Array(boxResponse.value));
              const lastClaimValue = Number(valueBuffer.readBigUInt64BE(0));
              setLastClaimBlock(lastClaimValue);

              const blocksPassed = currentRound - lastClaimValue;
              const remainingBlocks = BLOCKS_BETWEEN_CLAIMS - blocksPassed;

              if (remainingBlocks <= 0) {
                setRemainingBlocksText("Claim available!");
              } else {
                setRemainingBlocksText(`Next claim in ${remainingBlocks} blocks`);
              }
            } else {
              setLastClaimBlock(0);
              setRemainingBlocksText("Claim available!");
            }
          } else {
            setLastClaimBlock(0);
            setRemainingBlocksText("Claim available!");
          }
        } catch (error: any) {
          if (error.status !== 404) {
            console.error('Error fetching block info:', error);
          }
          setLastClaimBlock(0);
          setRemainingBlocksText("Claim available!");
        }
      } catch (error) {
        console.error('Error fetching block info:', error);
      }
    };

    fetchBlockInfo();
    if (!activeAddress) return;
    const interval = setInterval(fetchBlockInfo, 3000);
    return () => clearInterval(interval);
  }, [activeAddress, currentBlock, lastClaimBlock]);

  // const toggleQRCode = () => {
  //   setShowQRCode(!showQRCode);
  // };

  return (
    <div className="landing-page">
      <div style={{ position: 'fixed', top: '20px', right: '20px', zIndex: 30000, display: 'flex', gap: '10px', alignItems: 'center' }}>
        <CreatorTools />
        <ThemeToggle />
        <ConnectWallet />
      </div>

      <div style={{
        position: 'absolute',
        top: '16%',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '100%',
        textAlign: 'center'
      }}>
        <h1 className="main-title" style={{
          position: 'static',
          transform: 'none',
          margin: '0 0 0.3rem 0',
          fontSize: '4rem',
          letterSpacing: '4px',
          textShadow: 'none',
          fontWeight: '700',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale'
        }}>AlgoFaucet</h1>
        <p style={{
          color: '#ffffff',
          fontSize: '1.2rem',
          marginTop: '-0.5rem',
          fontWeight: '400',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale'
        }}>
          Get free ALGO on Algorand Mainnet
        </p>
      </div>

      <Faucet
        openModal={true}
        setModalState={setModalState}
        remainingBlocksText={remainingBlocksText}
      />

      <div style={{
        position: 'fixed',
        bottom: '40px',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '100%',
        maxWidth: '600px',
        padding: '0 20px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        zIndex: 10
      }}>
        <Donation />
      </div>
    </div>
  );
};

export default Home;
