/** Legislative / government bill-style section body (stored JSON in section.body). */

export const BILL_FORMAT = 'bill_v1';

export const SECTION_TYPES = [
  { id: 'preamble', label: 'Preamble (WHEREAS)', numbering: 'none', pdfStyle: 'preamble' },
  { id: 'enacting', label: 'Enacting formula (BE IT ENACTED)', numbering: 'none', pdfStyle: 'enacting' },
  { id: 'part', label: 'PART (division)', numbering: 'part', pdfStyle: 'part' },
  { id: 'chapter', label: 'CHAPTER', numbering: 'chapter', pdfStyle: 'chapter' },
  { id: 'section', label: 'Section', numbering: 'section', pdfStyle: 'section' },
  { id: 'subsection', label: 'Subsection', numbering: 'subsection', pdfStyle: 'subsection' },
  { id: 'paragraph', label: 'Paragraph', numbering: 'paragraph', pdfStyle: 'paragraph' },
  { id: 'definition', label: 'Definitions block', numbering: 'section', pdfStyle: 'definition' },
  { id: 'schedule', label: 'SCHEDULE / Annexure', numbering: 'schedule', pdfStyle: 'schedule' },
];

const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'];

export function newClause(text = '', number = '') {
  return { id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, number, text, children: [] };
}

export function newChildClause(text = '', number = '') {
  return { id: `sc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, number, text };
}

export function emptyBillSection(type = 'section', title = '', sortOrder = 0) {
  return {
    section_number: '',
    title,
    sort_order: sortOrder,
    section_type: type,
    clauses: [newClause('', '')],
    body: '',
  };
}

export function parseSectionBody(body, fallbackTitle = '') {
  if (!body) {
    return { format: BILL_FORMAT, section_type: 'section', clauses: [newClause('', '')] };
  }
  const raw = String(body).trim();
  if (raw.startsWith('{')) {
    try {
      const j = JSON.parse(raw);
      if (j.format === BILL_FORMAT) {
        return {
          format: BILL_FORMAT,
          section_type: j.section_type || 'section',
          clauses: Array.isArray(j.clauses) && j.clauses.length ? j.clauses : [newClause('', '')],
        };
      }
    } catch (_) {
      /* legacy html */
    }
  }
  return {
    format: 'legacy_html',
    section_type: 'section',
    clauses: [newClause(stripTags(raw), '')],
  };
}

export function serializeSectionBody(section) {
  if (section.format === 'legacy_html' && section.body && !section.clauses?.length) {
    return section.body;
  }
  return JSON.stringify({
    format: BILL_FORMAT,
    section_type: section.section_type || 'section',
    clauses: section.clauses || [newClause('', '')],
  });
}

export function normalizeSectionFromApi(row) {
  const parsed = parseSectionBody(row.body, row.title);
  return {
    id: row.id,
    section_number: row.section_number || '',
    title: row.title || '',
    sort_order: row.sort_order ?? 0,
    section_type: parsed.section_type,
    clauses: parsed.clauses,
    format: parsed.format,
    body: row.body,
  };
}

export function prepareSectionForSave(section) {
  return {
    section_number: section.section_number || '',
    title: section.title || '',
    sort_order: section.sort_order ?? 0,
    body: serializeSectionBody(section),
  };
}

function stripTags(html) {
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .trim();
}

/** Government bill skeleton (SA Parliament–style structure). */
export function governmentBillTemplate() {
  return [
    {
      section_type: 'preamble',
      section_number: '',
      title: 'Preamble',
      clauses: [
        newClause(
          'WHEREAS the Constitution provides that everyone has the right to fair labour practices;',
          ''
        ),
        newClause(
          'AND WHEREAS it is necessary for this organisation to give effect to statutory duties and internal governance;',
          ''
        ),
        newClause('AND WHEREAS it is expedient to provide for matters connected therewith;', ''),
      ],
    },
    {
      section_type: 'enacting',
      section_number: '',
      title: 'Enacting formula',
      clauses: [
        newClause(
          'BE IT ENACTED by the authority of this organisation, as follows:—',
          ''
        ),
      ],
    },
    {
      section_type: 'part',
      section_number: 'PART I',
      title: 'PRELIMINARY PROVISIONS',
      clauses: [newClause('', '')],
    },
    {
      section_type: 'chapter',
      section_number: 'CHAPTER 1',
      title: 'INTERPRETATION AND OBJECT',
      clauses: [newClause('', '')],
    },
    {
      section_type: 'definition',
      section_number: '1',
      title: 'Definitions',
      clauses: [
        newClause('In this policy, unless the context indicates otherwise—', '(1)'),
        {
          ...newClause('“term” means the meaning assigned in this section;', '(a)'),
          children: [newChildClause('any related meaning in the Companies Act applies;', '(i)')],
        },
      ],
    },
    {
      section_type: 'section',
      section_number: '2',
      title: 'Purpose',
      clauses: [newClause('The purpose of this policy is to …', '(1)')],
    },
    {
      section_type: 'section',
      section_number: '3',
      title: 'Application',
      clauses: [
        newClause('This policy applies to all employees and contractors of the organisation.', '(1)'),
        newClause('This policy binds every division, department, and operational unit.', '(2)'),
      ],
    },
    {
      section_type: 'part',
      section_number: 'PART II',
      title: 'CORE OBLIGATIONS',
      clauses: [newClause('', '')],
    },
    {
      section_type: 'section',
      section_number: '4',
      title: 'Duties of employees',
      clauses: [
        {
          ...newClause('Every employee must—', '(1)'),
          children: [
            newChildClause('comply with applicable law;', '(a)'),
            newChildClause('follow procedures issued under this policy;', '(b)'),
          ],
        },
      ],
    },
    {
      section_type: 'section',
      section_number: '5',
      title: 'Enforcement',
      clauses: [newClause('Failure to comply may result in disciplinary action.', '(1)')],
    },
    {
      section_type: 'schedule',
      section_number: 'SCHEDULE 1',
      title: 'Forms and annexures',
      clauses: [newClause('The forms referred to in this policy are listed herein.', '')],
    },
  ].map((s, i) => ({ ...s, sort_order: i }));
}

let partCounter = 0;
let chapterCounter = 0;
let sectionCounter = 0;
let scheduleCounter = 0;

function resetCounters() {
  partCounter = 0;
  chapterCounter = 0;
  sectionCounter = 0;
  scheduleCounter = 0;
}

export function autoNumberSections(sections) {
  resetCounters();
  return sections.map((s) => {
    const type = s.section_type || 'section';
    let section_number = s.section_number;

    if (type === 'part') {
      partCounter += 1;
      chapterCounter = 0;
      const roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'][partCounter - 1] || String(partCounter);
      section_number = `PART ${roman}`;
    } else if (type === 'chapter') {
      chapterCounter += 1;
      section_number = `CHAPTER ${chapterCounter}`;
    } else if (type === 'schedule') {
      scheduleCounter += 1;
      section_number = `SCHEDULE ${scheduleCounter}`;
    } else if (type === 'definition' || type === 'section' || type === 'subsection') {
      if (type !== 'subsection') sectionCounter += 1;
      section_number = type === 'subsection' ? s.section_number : String(sectionCounter);
    } else if (type === 'preamble' || type === 'enacting') {
      section_number = '';
    }

    const clauses = autoNumberClauses(s.clauses || [], type);
    return { ...s, section_number, clauses };
  });
}

function autoNumberClauses(clauses, sectionType) {
  if (sectionType === 'preamble' || sectionType === 'enacting' || sectionType === 'part' || sectionType === 'chapter') {
    return clauses.map((c) => ({ ...c, number: '' }));
  }
  return clauses.map((c, i) => {
    const number = sectionType === 'paragraph' ? `(${ROMAN[i] || i + 1})` : `(${i + 1})`;
    const children = (c.children || []).map((ch, j) => ({
      ...ch,
      number: `(${String.fromCharCode(97 + j)})`,
    }));
    return { ...c, number, children };
  });
}

export function sectionTypeLabel(id) {
  return SECTION_TYPES.find((t) => t.id === id)?.label || id;
}

export function plainTextFromSection(section) {
  const lines = [];
  const head = [section.section_number, section.title].filter(Boolean).join(' — ');
  if (head) lines.push(head);
  for (const c of section.clauses || []) {
    if (c.number) lines.push(`${c.number} ${c.text}`.trim());
    else lines.push(c.text);
    for (const ch of c.children || []) {
      lines.push(`  ${ch.number} ${ch.text}`.trim());
    }
  }
  return lines.filter(Boolean).join('\n');
}
