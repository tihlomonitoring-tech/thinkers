import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext';
import Layout from './Layout';
import Login from './Login';
import ForgotPassword from './ForgotPassword';
import ResetPassword from './ResetPassword';
import SignUp from './SignUp';
import UserManagement from './UserManagement';
import TenantManagement from './TenantManagement';
import Contractor from './Contractor';
import CommandCentre from './CommandCentre';
import AccessManagement from './AccessManagement';
import Rector from './Rector';
import Tasks from './Tasks';
import Profile from './Profile';
import Management from './Management';
import ReportBreakdown from './ReportBreakdown';
import TransportOperations from './TransportOperations';
import { getFirstAllowedPath } from './lib/pageAccess.js';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center bg-surface-100"><div className="animate-pulse text-surface-500">Loading…</div></div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function FirstAllowedRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-4 text-surface-500">Loading…</div>;
  const to = getFirstAllowedPath(user);
  return <Navigate to={to} replace />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/report-breakdown" element={<ReportBreakdown />} />
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/signup" element={<SignUp />} />
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<FirstAllowedRedirect />} />
        <Route path="users" element={<UserManagement />} />
        <Route path="tenants" element={<TenantManagement />} />
        <Route path="contractor" element={<Contractor />} />
        <Route path="command-centre" element={<CommandCentre />} />
        <Route path="access-management" element={<AccessManagement />} />
        <Route path="rector" element={<Rector />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="profile" element={<Profile />} />
        <Route path="management" element={<Management />} />
        <Route path="transport-operations" element={<TransportOperations />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
