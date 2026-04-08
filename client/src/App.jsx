import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
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
import Recruitment from './Recruitment';
import Letters from './Letters';
import AccountingManagement from './AccountingManagement';
import JobApplication from './JobApplication';
import NoAccess from './NoAccess';
import AppAttributionFooter from './components/AppAttributionFooter.jsx';
import { canAccessPage, getFirstAllowedPath, PATH_PAGE_IDS } from './lib/pageAccess.js';

const loadingShellFooterClass =
  'text-surface-500 dark:text-surface-400 border-t border-surface-200 dark:border-surface-800 bg-surface-100 dark:bg-surface-950';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex flex-col bg-surface-100 dark:bg-surface-950">
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-pulse text-surface-500 dark:text-surface-400">Loading…</div>
        </div>
        <AppAttributionFooter className={loadingShellFooterClass} />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function FirstAllowedRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-4 text-surface-500 dark:text-surface-400">Loading…</div>;
  const to = getFirstAllowedPath(user);
  return <Navigate to={to} replace />;
}

/** Redirects to the first allowed page when the user opens a URL they are not assigned. */
function PageGate({ pathKey, children }) {
  const { user, loading } = useAuth();
  const pageId = PATH_PAGE_IDS[pathKey];
  if (loading) {
    return (
      <div className="min-h-screen flex flex-col bg-surface-100 dark:bg-surface-950">
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-pulse text-surface-500 dark:text-surface-400">Loading…</div>
        </div>
        <AppAttributionFooter className={loadingShellFooterClass} />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (pageId && !canAccessPage(user, pageId)) {
    return <Navigate to={getFirstAllowedPath(user)} replace />;
  }
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/report-breakdown" element={<ReportBreakdown />} />
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/signup" element={<SignUp />} />
      <Route path="/apply/:token" element={<JobApplication />} />
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<FirstAllowedRedirect />} />
        <Route path="users" element={<PageGate pathKey="/users"><UserManagement /></PageGate>} />
        <Route path="tenants" element={<PageGate pathKey="/tenants"><TenantManagement /></PageGate>} />
        <Route path="contractor" element={<PageGate pathKey="/contractor"><Contractor /></PageGate>} />
        <Route path="command-centre" element={<PageGate pathKey="/command-centre"><CommandCentre /></PageGate>} />
        <Route path="access-management" element={<PageGate pathKey="/access-management"><AccessManagement /></PageGate>} />
        <Route path="rector" element={<PageGate pathKey="/rector"><Rector /></PageGate>} />
        <Route path="tasks" element={<PageGate pathKey="/tasks"><Tasks /></PageGate>} />
        <Route path="profile" element={<PageGate pathKey="/profile"><Profile /></PageGate>} />
        <Route path="management" element={<PageGate pathKey="/management"><Management /></PageGate>} />
        <Route path="recruitment" element={<PageGate pathKey="/recruitment"><Recruitment /></PageGate>} />
        <Route path="letters" element={<PageGate pathKey="/letters"><Letters /></PageGate>} />
        <Route path="accounting-management" element={<PageGate pathKey="/accounting-management"><AccountingManagement /></PageGate>} />
        <Route path="no-access" element={<NoAccess />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return <AppRoutes />;
}
