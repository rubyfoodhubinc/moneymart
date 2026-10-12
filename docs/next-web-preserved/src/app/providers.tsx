'use client';

/**
 * MoneyMart web — app providers.
 * React Query for server data, the session store bootstrap, and the shared
 * realtime socket registration (§9.2).
 */

import { useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getSocket } from '@/lib/socket';
import { useSession } from '@/store/session';

function Bootstrap({ children }: { children: ReactNode }) {
  const refresh = useSession((state) => state.refresh);
  const loadUsers = useSession((state) => state.loadUsers);
  const userId = useSession((state) => state.user?.id);

  useEffect(() => {
    void refresh();
    void loadUsers();
  }, [refresh, loadUsers]);

  // Join the personal notification room so outbid alerts land anywhere in the app.
  useEffect(() => {
    if (!userId) return;
    const socket = getSocket();
    socket.emit('user:join', userId);
  }, [userId]);

  return <>{children}</>;
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <Bootstrap>{children}</Bootstrap>
    </QueryClientProvider>
  );
}

export default Providers;
