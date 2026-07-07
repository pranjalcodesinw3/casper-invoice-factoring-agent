"use client";

import { truncateHex } from "@/lib/casper";
import { useWallet } from "@/lib/wallet";
import styles from "./WalletButton.module.css";

export default function WalletButton() {
  const wallet = useWallet();

  if (!wallet.configured) {
    return <div className={styles.unconfigured}>Wallet not configured</div>;
  }

  if (wallet.publicKeyHex) {
    return (
      <div className={styles.connected}>
        <span className={styles.dot} aria-hidden />
        <span className={styles.key}>{truncateHex(wallet.publicKeyHex)}</span>
        <button type="button" className={styles.disconnect} onClick={wallet.disconnect}>
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
