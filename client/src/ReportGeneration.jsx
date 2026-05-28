import { useAuth } from './AuthContext';
import ReportGenerationTab from './components/ReportGenerationTab.jsx';

export default function ReportGeneration() {
  const { user } = useAuth();
  return (
    <div className="min-h-full bg-surface-50 dark:bg-surface-950">
      <ReportGenerationTab user={user} />
    </div>
  );
}
