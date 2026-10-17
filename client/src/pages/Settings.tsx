import { AdminConsole } from './AdminConsole';
import { useSession } from '../lib/sessionContext';

/**
 * /settings is the admin console, and for everyone else it is a sentence.
 *
 * Everything that used to be here is shared data only an admin refreshes, so a normal
 * user gets nothing rather than a row of controls that refuse. The console lives in its
 * own file; this is the gate. The route is checked again on the server side by the row
 * policies and the Edge Functions — hiding a page is a courtesy to the reader.
 *
 * There is no display-currency control any more. It offered six currencies backed by an
 * fx_rates table that held zero rows for its whole life, so it had never once converted
 * anything — it only chose which chart opened first. One source means one currency, and a
 * selector that silently does nothing is worse than none.
 */
export function Settings() {
  const { admin } = useSession();

  if (!admin) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="mt-6 text-sm text-[var(--color-text-muted)]">
          Nothing to configure yet. Your collection and want lists are under your account
          menu.
        </p>
      </div>
    );
  }

  return <AdminConsole />;
}
