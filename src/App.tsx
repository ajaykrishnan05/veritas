import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.tsx';
import { Spinner } from './components/ui.tsx';
import { AuthProvider, useAuth } from './features/auth/AuthContext.tsx';
import AuditPage from './pages/AuditPage.tsx';
import DashboardPage from './pages/DashboardPage.tsx';
import InvoiceReviewPage from './pages/InvoiceReviewPage.tsx';
import LoginPage from './pages/LoginPage.tsx';
import UploadPage from './pages/UploadPage.tsx';

function Protected() {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-8"><Spinner label="Checking your session…" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Layout />;
}

function Routing() {
  const { user, loading } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={!loading && user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route element={<Protected />}>
        <Route index element={<DashboardPage />} />
        <Route path="upload" element={<UploadPage />} />
        <Route path="invoices/:id" element={<InvoiceReviewPage />} />
        <Route path="audit" element={<AuditPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routing />
    </AuthProvider>
  );
}
