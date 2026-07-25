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
import type { AccountType } from "@make-software/csprclick-core-types";

export interface SendDeployOutcome {
  cancelled: boolean;
  deployHash: string | null;
  error: string | null;
}

interface WalletState {
  /** True once the CSPR.click runtime is loaded and ready. */
  configured: boolean;
  account: AccountType | null;
  publicKeyHex: string | null;
  connect: () => void;
  disconnect: () => void;
  sendDeploy: (deployJson: unknown, signingPublicKeyHex: string) => Promise<SendDeployOutcome>;
}

interface ClickSdk {
  signIn: () => void;
  signOut: () => void;
  send: (deployJson: object, signingPublicKeyHex: string) => Promise<{
    cancelled?: boolean;
    deployHash?: string | null;
    transactionHash?: string | null;
    error?: string | null;
  }>;
  getActiveAccount: () => AccountType | null;
  getActiveAccountAsync: (opts?: unknown) => Promise<AccountType | null | undefined>;
  on: (event: string, handler: (payload?: { account?: AccountType }) => void) => void;
  off: (event: string, handler: (payload?: { account?: AccountType }) => void) => void;
}

const WalletContext = createContext<WalletState | null>(null);

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error("useWallet must be called within <WalletProvider>");
  }
  return ctx;
}

const APP_ID = process.env.NEXT_PUBLIC_CSPR_CLICK_APP_ID || "csprclick-template";
const CDN = "https://cdn.cspr.click/ui/v2.1.0/csprclick-client-2.1.0.js";

/**
 * CSPR.click via the official CDN runtime (docs: React Context Provider).
 * The runtime mounts the themed sign-in modal into the `csprclick-ui`
 * container; avoids the bundled React `ClickUI` theme crash under the Next.js
 * App Router.
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const [clickRef, setClickRef] = useState<ClickSdk | null>(null);
  const [account, setAccount] = useState<AccountType | null>(null);

  useEffect(() => {
    const w = window as unknown as {
      clickUIOptions: unknown;
      clickSDKOptions: unknown;
      csprclick?: ClickSdk;
    };

    w.clickUIOptions = {
      uiContainer: "csprclick-ui",
      rootAppElement: "body",
      show1ClickModal: true,
      showTopBar: false,
      accountMenuItems: ["AccountCardMenuItem", "CopyHashMenuItem"],
      defaultTheme: "dark",
    };
    w.clickSDKOptions = {
      appName: "Invoice Factoring Agent",
      appId: APP_ID,
      providers: ["casper-wallet", "ledger", "metamask-snap"],
      contentMode: "iframe",
    };

    let cancelled = false;
    let wired = false;

    const adopt = () => {
      if (cancelled || wired) return Boolean(w.csprclick);
      const ref = w.csprclick;
      if (!ref || typeof ref.signIn !== "function") return false;
      wired = true;
      setClickRef(ref);
      const sync = () => {
        try {
          setAccount(ref.getActiveAccount());
        } catch {
          /* not signed in yet */
        }
      };
      const clear = () => setAccount(null);
      ref.on("csprclick:signed_in", sync);
      ref.on("csprclick:switched_account", sync);
      ref.on("csprclick:signed_out", clear);
      ref.on("csprclick:disconnected", clear);
      ref
        .getActiveAccountAsync()
        .then((a) => {
          if (!cancelled) setAccount(a?.public_key ? a : null);
        })
        .catch(() => {});
      return true;
    };

    window.addEventListener("csprclick:loaded", adopt);
    adopt();

    if (!document.getElementById("csprclick-client")) {
      const script = document.createElement("script");
      script.src = CDN;
      script.id = "csprclick-client";
      script.async = true;
      document.head.appendChild(script);
    }

    // CDN may finish before this effect (dynamic import / Strict Mode), so poll.
    const poll = window.setInterval(() => {
      if (adopt()) window.clearInterval(poll);
    }, 50);
    const stop = window.setTimeout(() => window.clearInterval(poll), 20000);

    return () => {
      cancelled = true;
      window.removeEventListener("csprclick:loaded", adopt);
      window.clearInterval(poll);
      window.clearTimeout(stop);
    };
  }, []);

  const connect = useCallback(() => {
    try {
      clickRef?.signIn();
    } catch (err) {
      console.error("[wallet] signIn failed:", err);
    }
  }, [clickRef]);

  const disconnect = useCallback(() => {
    try {
      clickRef?.signOut();
    } catch (err) {
      console.error("[wallet] signOut failed:", err);
    }
    setAccount(null);
  }, [clickRef]);

  const sendDeploy = useCallback(
    async (deployJson: unknown, signingPublicKeyHex: string): Promise<SendDeployOutcome> => {
      if (!clickRef) {
        return { cancelled: true, deployHash: null, error: "Wallet is still loading" };
      }
      try {
        const result = await clickRef.send(deployJson as object, signingPublicKeyHex);
        if (!result) {
          return { cancelled: true, deployHash: null, error: "No response from wallet" };
        }
        return {
          cancelled: Boolean(result.cancelled),
          deployHash: result.deployHash ?? result.transactionHash ?? null,
          error: result.error ?? null,
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
      configured: clickRef != null,
      account,
      publicKeyHex: account?.public_key ?? null,
      connect,
      disconnect,
      sendDeploy,
    }),
    [clickRef, account, connect, disconnect, sendDeploy]
  );

  return (
    <WalletContext.Provider value={value}>
      <div id="csprclick-ui-wrapper">
        <div id="csprclick-ui" />
      </div>
      {children}
    </WalletContext.Provider>
  );
}
