import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { useAuth } from './auth';
import { Layout } from './Layout';
import { Data } from './pages/Data';
import { Overview } from './pages/Overview';
import { Plan } from './pages/Plan';
import { Regulars } from './pages/Regulars';
import { Events } from './pages/Events';
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
          <Route path="events" element={<Events />} />
          <Route path="trips" element={<Navigate to="/events" replace />} />
          <Route path="regulars" element={<Regulars />} />
          <Route path="plan" element={<Plan />} />
          <Route path="data" element={<Data />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
