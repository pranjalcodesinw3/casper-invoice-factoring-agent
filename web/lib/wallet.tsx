"use client";

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ClickProvider, ClickUI, ThemeModeType, useClickRef } from "@make-software/csprclick-ui";
import { CONTENT_MODE, CSPRCLICK_EVENTS } from "@make-software/csprclick-types";
import type { AccountType } from "@make-software/csprclick-core-types";
import { CHAIN_NAME } from "./casper";

export interface SendDeployOutcome {
  cancelled: boolean;
  deployHash: string | null;
  error: string | null;
}

interface WalletState {
  /** True once the CSPR.click SDK has an appId to initialize against. */
  configured: boolean;
  account: AccountType | null;
  publicKeyHex: string | null;
  connect: () => void;
  disconnect: () => void;
  sendDeploy: (deployJson: unknown, signingPublicKeyHex: string) => Promise<SendDeployOutcome>;
}

const WalletContext = createContext<WalletState | null>(null);

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error("useWallet must be called within <WalletProvider>");
  }
  return ctx;
}

/**
 * Bridges the CSPR.click SDK (only reachable via `useClickRef()` inside a
 * `<ClickProvider>`) into a plain React context so the rest of the app does not
 * need to know about the SDK's event-emitter shape.
 */
function WalletBridge({ children }: { children: ReactNode }) {
  const clickRef = useClickRef();
  const [account, setAccount] = useState<AccountType | null>(null);

  useEffect(() => {
    if (!clickRef) return;

    const syncActiveAccount = () => {
      try {
        setAccount(clickRef.getActiveAccount());
      } catch (err) {
        console.error("[wallet] failed to read active account:", err);
      }
    };
    const clearAccount = () => setAccount(null);

    syncActiveAccount();
    clickRef.on(CSPRCLICK_EVENTS.SIGNED_IN, syncActiveAccount);
    clickRef.on(CSPRCLICK_EVENTS.SWITCHED_ACCOUNT, syncActiveAccount);
    clickRef.on(CSPRCLICK_EVENTS.SIGNED_OUT, clearAccount);
    clickRef.on(CSPRCLICK_EVENTS.DISCONNECTED, clearAccount);

    return () => {
      clickRef.off(CSPRCLICK_EVENTS.SIGNED_IN, syncActiveAccount);
      clickRef.off(CSPRCLICK_EVENTS.SWITCHED_ACCOUNT, syncActiveAccount);
      clickRef.off(CSPRCLICK_EVENTS.SIGNED_OUT, clearAccount);
      clickRef.off(CSPRCLICK_EVENTS.DISCONNECTED, clearAccount);
    };
  }, [clickRef]);

  const connect = useCallback(() => {
    try {
      clickRef.signIn();
    } catch (err) {
      console.error("[wallet] signIn failed:", err);
    }
  }, [clickRef]);

  const disconnect = useCallback(() => {
    try {
      clickRef.signOut();
    } catch (err) {
      console.error("[wallet] signOut failed:", err);
    }
  }, [clickRef]);

  const sendDeploy = useCallback(
    async (deployJson: unknown, signingPublicKeyHex: string): Promise<SendDeployOutcome> => {
      try {
        const result = await clickRef.send(deployJson as object, signingPublicKeyHex);
        if (!result) {
          return { cancelled: true, deployHash: null, error: "No response from wallet" };
        }
        return {
          cancelled: result.cancelled,
          deployHash: result.deployHash,
          error: result.error,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[wallet] send failed:", message);
        return { cancelled: false, deployHash: null, error: message };
      }
    },
    [clickRef]
  );

  const value = useMemo<WalletState>(
    () => ({
      configured: true,
      account,
      publicKeyHex: account?.public_key ?? null,
      connect,
      disconnect,
      sendDeploy,
    }),
    [account, connect, disconnect, sendDeploy]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

const unconfiguredWallet: WalletState = {
  configured: false,
  account: null,
  publicKeyHex: null,
  connect: () => console.error("[wallet] NEXT_PUBLIC_CSPR_CLICK_APP_ID is not set"),
  disconnect: () => undefined,
  sendDeploy: async () => ({
    cancelled: true,
    deployHash: null,
    error: "Wallet is not configured (missing NEXT_PUBLIC_CSPR_CLICK_APP_ID)",
  }),
};

export function WalletProvider({ children }: { children: ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_CSPR_CLICK_APP_ID;

  if (!appId) {
    return (
      <WalletContext.Provider value={unconfiguredWallet}>{children}</WalletContext.Provider>
    );
  }

  const clickOptions = {
    appName: "Invoice Factoring Agent",
    appId,
    contentMode: CONTENT_MODE.IFRAME,
    providers: ["casper-wallet", "ledger", "casperdash", "metamask-snap"],
    chainName: CHAIN_NAME,
  };

  return (
    <ClickProvider options={clickOptions}>
      <ClickUI themeMode={ThemeModeType.dark} />
      <WalletBridge>{children}</WalletBridge>
    </ClickProvider>
  );
}
