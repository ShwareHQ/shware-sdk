import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { toast } from 'sonner';

/**
 * Query client for the studio.
 *
 * Every failure surfaces as a toast: the data here comes from the user's own
 * `stats` functions, and a silent failure would look identical to "no data",
 * which is exactly the confusion the reports view is meant to avoid.
 */
export function getTanstackQueryContext() {
  const onError = (error: Error) => {
    toast.error(error.message || 'Something went wrong');
  };

  const queryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      // Definitions are read from the local filesystem and stats from the user's
      // own source; neither benefits from aggressive background refetching.
      queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
    },
  });

  return { queryClient };
}

interface Props {
  children: ReactNode;
  queryClient: QueryClient;
}

export function TanstackQueryProvider({ children, queryClient }: Props) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
