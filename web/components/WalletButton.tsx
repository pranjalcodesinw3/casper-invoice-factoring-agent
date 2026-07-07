"use client";

import { useWallet } from "@/lib/wallet";
import styles from "./WalletButton.module.css";

export default function WalletButton() {
  const wallet = useWallet();

  if (!wallet.configured) {
    return (
      <span className={styles.hint}>Set NEXT_PUBLIC_CSPR_CLICK_APP_ID to connect</span>
    );
  }

  if (wallet.account) {
    const label = wallet.publicKeyHex
      ? `${wallet.publicKeyHex.slice(0, 8)}...${wallet.publicKeyHex.slice(-6)}`
      : "Connected";
    return (
      <div className={styles.row}>
        <span className={styles.connected}>{label}</span>
        <button type="button" className={styles.button} onClick={wallet.disconnect}>
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button type="button" className={styles.button} onClick={wallet.connect}>
      Connect wallet
    </button>
  );
}
