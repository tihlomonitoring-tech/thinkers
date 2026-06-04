/**
 * South African government labour policy library — draft bills for workplace implementation.
 * Seeded as editable drafts (reference prefix GOV-LAB-*).
 */

const BILL = 'bill_v1';

function clause(text, number = '', children = []) {
  const c = {
    id: `c-${Math.random().toString(36).slice(2, 9)}`,
    number,
    text,
    children: children.map((ch, i) => ({
      id: `sc-${i}-${Math.random().toString(36).slice(2, 7)}`,
      number: ch.number || '',
      text: ch.text || '',
    })),
  };
  return c;
}

function block(section_type, section_number, title, clauses, sort_order) {
  return {
    section_number,
    title,
    sort_order,
    body: JSON.stringify({
      format: BILL,
      section_type,
      clauses: clauses.length ? clauses : [clause('', '')],
    }),
  };
}

function basePreamble(orgPhrase = 'this organisation') {
  return [
    block('preamble', '', 'Preamble', [
      clause(
        'WHEREAS the Constitution of the Republic of South Africa, 1996, enshrines the right to fair labour practices;',
        ''
      ),
      clause(
        `AND WHEREAS ${orgPhrase} is required to align its workplace rules with applicable labour legislation of the Republic of South Africa;`,
        ''
      ),
      clause('AND WHEREAS it is necessary to provide clear internal standards for managers and employees;', ''),
    ], 0),
    block('enacting', '', 'Enacting formula', [
      clause(
        'BE IT ENACTED by the management of the organisation, as an internal workplace policy giving effect to the applicable Act, as follows:—',
        ''
      ),
    ], 1),
  ];
}

/** @returns {Array<{ reference_number, title, act_or_section, summary, policy_type, department_name, sections }>} */
export function getGovernmentLabourPolicySeeds() {
  return [
    {
      reference_number: 'GOV-LAB-BCEA-001',
      title:
        'Basic Conditions of Employment — Workplace Policy Bill (Alignment with Act 75 of 1997)',
      act_or_section: 'Basic Conditions of Employment Act, 1997 (Act 75 of 1997)',
      summary:
        'Internal bill setting out working time, leave, remuneration documentation, and termination notice standards required under the BCEA for employees earning below the earnings threshold and general workforce.',
      policy_type: 'bill',
      department_name: 'Human Resources / Labour',
      sections: [
        ...basePreamble(),
        block('part', 'PART I', 'PRELIMINARY PROVISIONS', [], 2),
        block('definition', '1', 'Definitions', [
          clause('In this policy, unless the context indicates otherwise—', '(1)'),
          clause('“BCEA” means the Basic Conditions of Employment Act, 1997;', '(a)'),
          clause('“employee” has the meaning assigned in the BCEA and includes fixed-term and part-time employees;', '(b)'),
          clause('“working time” means time during which an employee is required to be at the workplace or perform duties;', '(c)'),
        ], 3),
        block('section', '2', 'Purpose and authority', [
          clause(
            'The purpose of this policy is to give effect to the BCEA within the organisation and to set minimum standards that may not be less favourable than the Act unless a permitted variation exists.',
            '(1)'
          ),
        ], 4),
        block('section', '3', 'Application', [
          clause('This policy applies to all employees except independent contractors and genuine senior managerial employees where exclusions are lawfully recorded.', '(1)'),
          clause('Sectoral determinations and collective agreements that are more favourable prevail over this policy where applicable.', '(2)'),
        ], 5),
        block('part', 'PART II', 'WORKING TIME AND LEAVE', [], 6),
        block('section', '4', 'Ordinary hours of work', [
          clause('Ordinary working hours may not exceed 45 hours per week unless an averaging agreement is concluded in writing in terms of the BCEA.', '(1)'),
          clause('Overtime must be voluntary or agreed, compensated as required by law, and recorded on approved timesheets.', '(2)'),
        ], 7),
        block('section', '5', 'Leave entitlements', [
          clause('Employees accrue annual leave, sick leave, and family responsibility leave in accordance with the BCEA and any applicable collective agreement.', '(1)'),
          clause('Maternity, parental, and adoption leave must be administered as prescribed; no employee may be disadvantaged for taking statutory leave.', '(2)'),
        ], 8),
        block('section', '6', 'Particulars of employment', [
          clause('Written particulars of employment must be issued at commencement and updated when material terms change.', '(1)'),
          clause('Records of remuneration, deductions, and leave balances must be retained for the period required by law.', '(2)'),
        ], 9),
        block('schedule', 'SCHEDULE 1', 'Related forms', [
          clause('Form HR-1: Particulars of employment checklist; Form HR-2: Leave application and approval record.', ''),
        ], 10),
      ],
    },
    {
      reference_number: 'GOV-LAB-LRA-002',
      title: 'Labour Relations — Workplace Policy Bill (Alignment with Act 66 of 1995)',
      act_or_section: 'Labour Relations Act, 1995 (Act 66 of 1995)',
      summary:
        'Framework for collective workplace governance, dispute resolution, industrial action controls, and unfair labour practice avoidance.',
      policy_type: 'bill',
      department_name: 'Human Resources / Employee Relations',
      sections: [
        ...basePreamble(),
        block('part', 'PART I', 'INTERPRETATION', [], 2),
        block('definition', '1', 'Definitions', [
          clause('In this policy—', '(1)'),
          clause('“LRA” means the Labour Relations Act, 1995;', '(a)'),
          clause('“CCMA” means the Commission for Conciliation and Mediation and Arbitration;', '(b)'),
          clause('“unfair labour practice” has the meaning assigned in section 186 of the LRA;', '(c)'),
        ], 3),
        block('part', 'PART II', 'WORKPLACE RELATIONS', [], 4),
        block('section', '2', 'Freedom of association', [
          clause('No employee may be prejudiced for joining or refusing to join a trade union or for participating in lawful union activities.', '(1)'),
        ], 5),
        block('section', '3', 'Discipline and incapacity', [
          clause('Disciplinary hearings must be conducted fairly: adequate notice, disclosure of allegations, and opportunity to respond.', '(1)'),
          clause('Incapacity inquiries (ill health or poor performance) must follow progressive counselling and reasonable accommodation where appropriate.', '(2)'),
        ], 6),
        block('section', '4', 'Grievance procedure', [
          clause('Employees must first exhaust internal grievance steps before external referral, unless urgency or statutory rights require otherwise.', '(1)'),
          clause('Grievances must be logged, investigated, and answered in writing within prescribed timeframes.', '(2)'),
        ], 7),
        block('section', '5', 'Industrial action', [
          clause('Participation in unprotected strike action may result in disciplinary measures consistent with the LRA and case law.', '(1)'),
          clause('Management must follow lock-out and picketing rules where operational continuity is affected.', '(2)'),
        ], 8),
      ],
    },
    {
      reference_number: 'GOV-LAB-OHS-003',
      title:
        'Occupational Health and Safety — Workplace Policy Bill (Alignment with Act 85 of 1993)',
      act_or_section: 'Occupational Health and Safety Act, 1993 (Act 85 of 1993)',
      summary:
        'Duties of employers and employees regarding hazard identification, safe systems of work, incident reporting, and health and safety representatives.',
      policy_type: 'bill',
      department_name: 'Safety / Operations',
      sections: [
        ...basePreamble('employees and contractors working on behalf of the organisation'),
        block('part', 'PART I', 'GENERAL DUTIES', [], 2),
        block('section', '1', 'Employer duties (section 8)', [
          clause('The organisation must provide and maintain a working environment that is safe and without risk to health, so far as is reasonably practicable.', '(1)'),
          clause('Hazard identification, risk assessment, and control measures must be documented and reviewed after incidents or process changes.', '(2)'),
        ], 3),
        block('section', '2', 'Employee duties (section 14)', [
          clause('Every employee must—', '(1)', [
            { number: '(a)', text: 'take reasonable care for their own health and safety and that of others;' },
            { number: '(b)', text: 'co-operate with lawful instructions and safety procedures;' },
            { number: '(c)', text: 'report unsafe conditions and incidents without delay;' },
          ]),
        ], 4),
        block('section', '3', 'Incident reporting', [
          clause('All recordable injuries, dangerous occurrences, and occupational diseases must be reported internally within 24 hours and to the Department of Employment and Labour where required.', '(1)'),
        ], 5),
        block('section', '4', 'Personal protective equipment', [
          clause('PPE required for a task must be provided, maintained, and used; failure to use mandated PPE is a disciplinary matter.', '(1)'),
        ], 6),
        block('schedule', 'SCHEDULE 1', 'Safety committee terms', [
          clause('Health and safety representatives and committee meeting frequency as per the General Administrative Regulations.', ''),
        ], 7),
      ],
    },
    {
      reference_number: 'GOV-LAB-EEA-004',
      title: 'Employment Equity — Workplace Policy Bill (Alignment with Act 55 of 1998)',
      act_or_section: 'Employment Equity Act, 1998 (Act 55 of 1998)',
      summary:
        'Elimination of unfair discrimination and implementation of affirmative action measures through EE plans, reporting, and reasonable accommodation.',
      policy_type: 'bill',
      department_name: 'Human Resources / Transformation',
      sections: [
        ...basePreamble(),
        block('definition', '1', 'Definitions', [
          clause('“designated groups” means black people, women, and persons with disabilities as defined in the Employment Equity Act;', '(1)'),
          clause('“unfair discrimination” is prohibited on any arbitrary ground including race, gender, pregnancy, and HIV status;', '(2)'),
        ], 2),
        block('section', '2', 'Employment Equity Plan', [
          clause('The organisation must prepare, implement, and report on an Employment Equity Plan for each reporting period.', '(1)'),
          clause('Numerical goals and affirmative action measures must be applied consistently in recruitment, promotion, and training.', '(2)'),
        ], 3),
        block('section', '3', 'Harassment and dignity', [
          clause('Sexual harassment, bullying, and hate speech in the workplace constitute serious misconduct and may lead to dismissal.', '(1)'),
        ], 4),
      ],
    },
    {
      reference_number: 'GOV-LAB-NES-005',
      title: 'National Minimum Wage — Workplace Policy Bill (Act 9 of 2018)',
      act_or_section: 'National Minimum Wage Act, 2018 (Act 9 of 2018)',
      summary:
        'Ensures remuneration meets or exceeds the national minimum wage and records adjustments published annually by the Minister.',
      policy_type: 'bill',
      department_name: 'Human Resources / Payroll',
      sections: [
        ...basePreamble(),
        block('section', '1', 'Minimum remuneration', [
          clause('No employee may be paid below the national minimum wage per ordinary hour worked, except where a lawful exemption applies.', '(1)'),
          clause('Payroll must implement ministerial adjustments from the effective date published in the Government Gazette.', '(2)'),
        ], 2),
        block('section', '2', 'Farm and domestic workers', [
          clause('Sector-specific minimums where higher than the national minimum wage must be applied and audited quarterly.', '(1)'),
        ], 3),
      ],
    },
    {
      reference_number: 'GOV-LAB-SDL-006',
      title: 'Skills Development Levies — Workplace Policy Bill (Act 9 of 1999)',
      act_or_section: 'Skills Development Levies Act, 1999 (Act 9 of 1999) and Skills Development Act, 1998',
      summary: 'Administration of the 1% levy, WSP/ATR submissions, and workplace skills plans.',
      policy_type: 'bill',
      department_name: 'Human Resources / Learning',
      sections: [
        ...basePreamble(),
        block('section', '1', 'Levy compliance', [
          clause('The organisation must register, pay, and reconcile skills development levies as required by SARS and the SETA.', '(1)'),
        ], 2),
        block('section', '2', 'Workplace skills plan', [
          clause('Annual Workplace Skills Plan and Training Report submissions must be approved by management before SETA deadlines.', '(1)'),
        ], 3),
      ],
    },
  ];
}

export const GOVERNMENT_LABOUR_REF_PREFIX = 'GOV-LAB-';

/**
 * Insert government labour policy drafts for a tenant.
 * @param {string} tenantId
 * @param {string|null} userId
 * @param {(sql: string, params: object) => Promise<any>} queryFn
 */
export async function seedGovernmentLabourPoliciesForTenant(tenantId, userId, queryFn) {
  const seeds = getGovernmentLabourPolicySeeds();
  const inserted = [];
  const skipped = [];

  for (const seed of seeds) {
    const exists = await queryFn(
      `SELECT id FROM company_policies WHERE tenant_id = @t AND reference_number = @ref`,
      { t: tenantId, ref: seed.reference_number }
    );
    if (exists.recordset?.[0]?.id) {
      skipped.push(seed.reference_number);
      continue;
    }

    const ins = await queryFn(
      `INSERT INTO company_policies (
        tenant_id, reference_number, title, act_or_section, summary, policy_type, classification,
        department_name, status, version, requires_acknowledgement, created_by_user_id, updated_by_user_id
      ) OUTPUT INSERTED.id VALUES (
        @t, @ref, @title, @act, @summary, @ptype, N'internal', @dept, N'draft', 0, 1, @uid, @uid
      )`,
      {
        t: tenantId,
        ref: seed.reference_number,
        title: seed.title,
        act: seed.act_or_section,
        summary: seed.summary,
        ptype: seed.policy_type || 'bill',
        dept: seed.department_name,
        uid: userId || null,
      }
    );
    const policyId = ins.recordset?.[0]?.id ?? ins.recordset?.[0]?.Id;
    if (!policyId) continue;

    for (const sec of seed.sections) {
      await queryFn(
        `INSERT INTO company_policy_sections (policy_id, section_number, title, body, sort_order)
         VALUES (@pid, @num, @title, @body, @ord)`,
        {
          pid: policyId,
          num: sec.section_number || '',
          title: sec.title || 'Provision',
          body: sec.body,
          ord: sec.sort_order ?? 0,
        }
      );
    }
    inserted.push(seed.reference_number);
  }

  return { inserted, skipped, total: seeds.length };
}
