import { AdminConsole } from './AdminConsole';
import { useSession } from '../lib/sessionContext';
import { Link } from 'react-router-dom';

/**
 * /admin is the console, and for everyone else it is a closed door.
 *
 * The gate used to live on /settings, which meant an admin had no settings page and
 * everybody else had a page with nothing on it. Splitting the two gives the console its own
 * address and its own row in the account menu, and leaves Settings to the reader.
 *
 * The route is checked again on the server side by the row policies and the Edge Functions
 * — hiding a page is a courtesy to the reader, not a control.
 */
export function AdminPanel() {
  const { admin } = useSession();

  if (!admin) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 text-center">
        <h1 className="text-2xl font-bold">Admin panel</h1>
        <p className="mt-3 text-sm text-[var(--color-text-muted)]">
          This is the catalogue's own instruments: price runs, set coverage, storage. Nothing
          here is about your cards.
        </p>
        <Link to="/collection" className="mt-6 inline-block text-sm text-[var(--color-accent)]">
          Back to My Collection
        </Link>
      </div>
    );
  }

  return <AdminConsole />;
}
