import { openAttachmentWithAuth } from '../../api';

/** Dual ticks: contractor + admin approval per action. */
export default function OnboardingActionRow({
  task,
  stageLocked,
  role,
  attachmentDownloadUrl,
  onContractorToggle,
  onAdminToggle,
  onUpload,
}) {
  const showContractor = ['contractor', 'both'].includes(task.assignee);
  const showAdmin = ['admin', 'both'].includes(task.assignee);
  const locked = stageLocked;

  return (
    <li className="text-sm border-b border-surface-100 dark:border-surface-800 pb-2 last:border-0">
      <p className={task.is_completed ? 'line-through text-surface-500' : 'font-medium'}>{task.title}</p>
      <div className="mt-1.5 flex flex-wrap gap-3 items-center text-xs">
        {showContractor && (
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={!!task.contractor_completed}
              disabled={locked || role !== 'contractor' || !onContractorToggle}
              onChange={(e) => onContractorToggle?.(e.target.checked)}
              className="rounded"
            />
            <span className="text-surface-500">Contractor</span>
          </label>
        )}
        {showAdmin && (
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={!!task.admin_completed}
              disabled={locked || role !== 'admin' || !onAdminToggle}
              onChange={(e) => onAdminToggle?.(e.target.checked)}
              className="rounded"
            />
            <span className="text-surface-500">Admin approval</span>
          </label>
        )}
        {!locked && onUpload && (
          <label className="text-brand-600 cursor-pointer">
            Upload
            <input
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUpload(f);
                e.target.value = '';
              }}
            />
          </label>
        )}
      </div>
      {task.attachments?.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs">
          {task.attachments.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                className="text-brand-600 underline"
                onClick={() => openAttachmentWithAuth(attachmentDownloadUrl(a.id))}
              >
                {a.original_name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
