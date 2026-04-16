import { useState, useEffect, useCallback } from 'react';
import { performanceEvaluations } from '../api';

export default function PerformanceEvaluationQuestionsEditor({ onError }) {
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newCat, setNewCat] = useState('work_environment');
  const [newText, setNewText] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    performanceEvaluations
      .listQuestions()
      .then((d) => setQuestions(d.questions || []))
      .catch((e) => onError?.(e?.message || 'Could not load questions'))
      .finally(() => setLoading(false));
  }, [onError]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    if (!newText.trim()) return;
    try {
      await performanceEvaluations.createQuestion({ category: newCat, question_text: newText.trim() });
      setNewText('');
      await load();
    } catch (e) {
      onError?.(e?.message || 'Add failed');
    }
  };

  const toggle = async (q) => {
    try {
      await performanceEvaluations.patchQuestion(q.id, { is_active: !(q.is_active === true || q.is_active === 1) });
      await load();
    } catch (e) {
      onError?.(e?.message || 'Update failed');
    }
  };

  const remove = async (id) => {
    if (!window.confirm('Deactivate this question? It will be hidden from new evaluations but kept for past answers.')) return;
    try {
      await performanceEvaluations.deleteQuestion(id);
      await load();
    } catch (e) {
      onError?.(e?.message || 'Delete failed');
    }
  };

  if (loading) return <p className="text-sm text-surface-500 py-4">Loading questions…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-surface-900 dark:text-surface-100">Edit evaluation questionnaires</h1>
        <p className="text-sm text-surface-600 dark:text-surface-400 mt-1 max-w-3xl">
          Active questions appear on the Performance evaluations page. Each requires a 1–3 score and a comment from evaluators.
        </p>
      </div>

      <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm space-y-3 dark:border-surface-800 dark:bg-surface-900">
        <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100">Add question</h2>
        <div className="flex flex-wrap gap-2 items-end">
          <div>
            <label className="text-xs text-surface-500">Category</label>
            <input
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
              className="block mt-1 rounded-lg border border-surface-200 px-2 py-1.5 text-sm w-44 dark:border-surface-700 dark:bg-surface-950"
            />
          </div>
          <div className="flex-1 min-w-[12rem]">
            <label className="text-xs text-surface-500">Question</label>
            <input
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              className="block mt-1 w-full rounded-lg border border-surface-200 px-2 py-1.5 text-sm dark:border-surface-700 dark:bg-surface-950"
            />
          </div>
          <button type="button" onClick={add} className="px-3 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold">
            Add
          </button>
        </div>
      </div>

      <ul className="space-y-2">
        {questions.map((q) => (
          <li
            key={q.id}
            className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-surface-200 bg-white p-3 dark:border-surface-800 dark:bg-surface-900"
          >
            <div>
              <span className="text-[10px] font-semibold uppercase text-surface-500">{q.category}</span>
              <p className="text-sm text-surface-800 dark:text-surface-100">{q.question_text}</p>
              <p className="text-xs text-surface-500 mt-1">{q.is_active === false || q.is_active === 0 ? 'Inactive' : 'Active'}</p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => toggle(q)} className="text-xs font-medium text-brand-600">
                Toggle active
              </button>
              <button type="button" onClick={() => remove(q.id)} className="text-xs font-medium text-red-600">
                Deactivate
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
