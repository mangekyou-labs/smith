import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { SolanaProvider } from "@/components/solana/SolanaProvider";

const queryClient = new QueryClient();

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <SolanaProvider>{children}</SolanaProvider>
    </QueryClientProvider>
  );
}
