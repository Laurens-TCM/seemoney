import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { useAuth } from './auth';
import { Layout } from './Layout';
import { Data } from './pages/Data';
import { Overview } from './pages/Overview';
import { Trips } from './pages/Trips';
import { Placeholder } from './pages/Placeholder';
import { SignIn } from './SignIn';

export function App() {
  const { session, loading } = useAuth();
  if (loading) return null;
  if (!session) return <SignIn />;
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Overview />} />
          <Route path="trips" element={<Trips />} />
          <Route path="plan" element={<Placeholder title="Plan" phase={6}>Goals, the offset, and what spending needs to look like.</Placeholder>} />
          <Route path="data" element={<Data />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
