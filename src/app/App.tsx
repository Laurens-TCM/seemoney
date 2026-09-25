import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { useAuth } from './auth';
import { Layout } from './Layout';
import { Data } from './pages/Data';
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
          <Route index element={<Placeholder title="Overview" phase={4}>Where the money goes each month, with trips left out.</Placeholder>} />
          <Route path="trips" element={<Placeholder title="Trips" phase={5}>Melbourne visits and holidays, and what they cost.</Placeholder>} />
          <Route path="plan" element={<Placeholder title="Plan" phase={6}>Goals, the offset, and what spending needs to look like.</Placeholder>} />
          <Route path="data" element={<Data />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
