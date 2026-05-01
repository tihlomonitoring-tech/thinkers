/**
 * South African leave types for seeding tenant `leave_types`.
 * sector: public (typical state/public service), private (typical private sector), both (BCEA / common).
 * default_days_per_year: typical planning figure where annual; see description for cycle-based types.
 */
export const SA_LEAVE_TYPES = [
  {
    name: 'Annual leave',
    sector: 'both',
    default_days_per_year: 15,
    sort_order: 10,
    description:
      'BCEA minimum 15 working days per annual cycle (often 21 in many contracts).',
  },
  {
    name: 'Sick leave',
    sector: 'both',
    default_days_per_year: 30,
    sort_order: 20,
    description:
      'BCEA: up to 30 days paid sick leave in a 36-month cycle (not a simple annual cap—confirm with HR).',
  },
  {
    name: 'Family responsibility leave',
    sector: 'both',
    default_days_per_year: 3,
    sort_order: 30,
    description: 'BCEA: 3 days per year when a child is born/sick or dependent dies (if eligible).',
  },
  {
    name: 'Maternity leave',
    sector: 'both',
    default_days_per_year: 120,
    sort_order: 40,
    description:
      'Up to 4 months unpaid under BCEA; UIF may apply. Days shown are calendar-day planning only—adjust per policy.',
  },
  {
    name: 'Parental leave',
    sector: 'both',
    default_days_per_year: 10,
    sort_order: 50,
    description: 'Parental benefits and duration depend on legislation and policy—confirm with HR.',
  },
  {
    name: 'Adoption leave',
    sector: 'both',
    default_days_per_year: 10,
    sort_order: 55,
    description: 'May align with parental benefits; duration per employer policy and law.',
  },
  {
    name: 'Compassionate / bereavement leave',
    sector: 'both',
    default_days_per_year: 3,
    sort_order: 60,
    description: 'Often 3–5 days by policy; may overlap with family responsibility leave rules.',
  },
  {
    name: 'Study leave',
    sector: 'both',
    default_days_per_year: 0,
    sort_order: 70,
    description:
      'Often formalised in public service; discretionary in private sector—set days in policy or employment contract.',
  },
  {
    name: 'Special / official duty leave',
    sector: 'public',
    default_days_per_year: 0,
    sort_order: 80,
    description: 'Public sector: official business, voting, etc. Per employer rules.',
  },
  {
    name: 'Religious or cultural leave',
    sector: 'both',
    default_days_per_year: 2,
    sort_order: 90,
    description: 'Often by agreement; not a universal statutory minimum.',
  },
  {
    name: 'Unpaid leave',
    sector: 'both',
    default_days_per_year: 0,
    sort_order: 100,
    description: 'No pay; by mutual agreement.',
  },
  {
    name: 'Leave in lieu / TOIL',
    sector: 'private',
    default_days_per_year: 0,
    sort_order: 110,
    description: 'Time off in lieu of overtime—private sector common; track per policy.',
  },
  {
    name: 'Occupational injury / IOD leave',
    sector: 'both',
    default_days_per_year: 0,
    sort_order: 120,
    description: 'Compensation Commissioner / COIDA-related; duration per case.',
  },
  {
    name: 'Public holiday (observed)',
    sector: 'both',
    default_days_per_year: 0,
    sort_order: 130,
    description: 'Optional type for recording public holidays if your process requires it.',
  },
];
