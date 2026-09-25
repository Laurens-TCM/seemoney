import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { AuthProvider } from './app/auth';
import { Crash } from './app/Crash';
import { builtWith, configError } from './lib/supabase';
import './styles.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: 1 } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Crash>
    {configError ? (
      <main className="signin"><div className="panel"><h1>See The Money</h1><p>{configError}</p>
        <p className="muted small">Add them in Vercel → Settings → Environment Variables, then redeploy.</p>
        <p className="muted small">This build received: {builtWith.length ? builtWith.join(', ') : 'no VITE_ variables'}.</p></div></main>
    ) : (
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </QueryClientProvider>
    )}
    </Crash>
  </StrictMode>,
);
