/**
 * One gate, in front of everything that keeps something.
 *
 * Every path that creates a collection, a want list, or files a card calls through here
 * first. Centralised because the alternative is a check at each call site, and the one
 * that gets forgotten is the one that reaches the database, fails a policy, and shows a
 * stack trace instead of an invitation.
 *
 * This is not the restriction. The restriction lives in the policies from migration 0014,
 * which refuse the insert regardless of what the interface does. This is what makes the
 * refusal explicable rather than an error.
 */
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useSession } from './sessionContext';
import { SignUpPrompt } from '../components/SignUpPrompt';

interface Gate {
  /**
   * True when the caller may proceed. When false the invitation is already on screen,
   * so the caller should simply stop — there is nothing further for it to report.
   *
   * `reason` names what they were trying to do, so the prompt can say it back to them
   * instead of explaining accounts in the abstract.
   */
  requireAccount: (reason: string) => boolean;
}

const RequireAccountContext = createContext<Gate>({ requireAccount: () => true });

export function useRequireAccount(): Gate {
  return useContext(RequireAccountContext);
}

export function RequireAccountProvider({ children }: { children: ReactNode }) {
  const { anonymous } = useSession();
  const [reason, setReason] = useState<string | null>(null);

  const requireAccount = useCallback(
    (why: string) => {
      if (!anonymous) return true;
      setReason(why);
      return false;
    },
    [anonymous],
  );

  const value = useMemo(() => ({ requireAccount }), [requireAccount]);

  return (
    <RequireAccountContext.Provider value={value}>
      {children}
      {reason && <SignUpPrompt reason={reason} onClose={() => setReason(null)} />}
    </RequireAccountContext.Provider>
  );
}
