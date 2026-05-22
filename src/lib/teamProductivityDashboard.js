/**
 * Build team-level productivity aggregates for management audit dashboard.
 */

const COMPONENT_KEYS = ['punctuality', 'evaluation', 'tasks', 'reportTiming', 'teamProgress', 'dailyPulse'];

function parseMemberIds(raw) {
  if (!raw) return [];
  try {
    const a = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(a) ? a.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

function emptyComponents() {
  return Object.fromEntries(COMPONENT_KEYS.map((k) => [k, 0]));
}

function addComponents(target, breakdown) {
  if (!breakdown) return;
  for (const k of COMPONENT_KEYS) {
    target[k] += breakdown[k]?.points || 0;
  }
}

function personSnapshot(scorePerson, tenantUser) {
  if (!scorePerson && !tenantUser) return null;
  const breakdown = scorePerson?.breakdown || null;
  return {
    user_id: scorePerson?.userId || tenantUser?.user_id,
    full_name: scorePerson?.full_name || tenantUser?.full_name || '—',
    email: scorePerson?.email || tenantUser?.email || '',
    productivity_total: scorePerson != null ? scorePerson.total : null,
    breakdown,
    daily_pulse_points: breakdown?.dailyPulse?.points ?? 0,
    daily_pulse_events: breakdown?.dailyPulse?.events?.length ?? 0,
  };
}

function pulseStatsFromEvents(events) {
  let on_time = 0;
  let missed = 0;
  let pending = 0;
  let points = 0;
  for (const ev of events || []) {
    points += ev.points || 0;
    const d = String(ev.detail || '');
    if (d === 'pulse_on_time') on_time += 1;
    else if (d === 'pulse_missed') missed += 1;
    else if (d === 'pending') pending += 1;
  }
  const decided = on_time + missed;
  const compliance_pct = decided ? Math.round((on_time / decided) * 1000) / 10 : null;
  return { on_time, missed, pending, points, compliance_pct, decided_shifts: decided };
}

/**
 * @param {object} opts
 * @param {Array} opts.objectives — shift_team_objectives rows with members_on_objective
 * @param {Map} opts.scoreByUserId — userId -> score person from computeTenantScores
 * @param {Map} opts.tenantUserById
 * @param {Array} opts.leaderRows — audit leader rows with user_id, full_name
 */
export function buildTeamProductivityDashboard(opts) {
  const { objectives = [], scoreByUserId, tenantUserById, leaderRows = [] } = opts;
  const teamsMap = new Map();

  const ensureTeam = (teamName, meta = {}) => {
    const key = String(teamName || 'Unnamed team').trim() || 'Unnamed team';
    if (!teamsMap.has(key)) {
      teamsMap.set(key, {
        team_key: key,
        team_name: key,
        leader_ids: new Set(),
        member_ids: new Set(),
        objective_ids: [],
        shift_types: new Set(),
        work_dates: [],
        ...meta,
      });
    }
    return teamsMap.get(key);
  };

  for (const o of objectives) {
    if (String(o.scope || o.Scope || '').toLowerCase() !== 'team') continue;
    const teamName = String(o.team_name || o.team_Name || o.title || 'Unnamed team').trim() || 'Unnamed team';
    const t = ensureTeam(teamName);
    const oid = o.id || o.Id;
    if (oid) t.objective_ids.push(String(oid));
    const lid = o.leader_user_id || o.leader_User_id;
    if (lid) t.leader_ids.add(String(lid));
    const st = o.shift_type || o.shift_Type;
    if (st) t.shift_types.add(String(st));
    const wd = o.work_date || o.work_Date;
    if (wd) t.work_dates.push(String(wd).slice(0, 10));
    const members = o.members_on_objective || [];
    for (const m of members) {
      if (m.user_id) t.member_ids.add(String(m.user_id));
    }
    parseMemberIds(o.member_user_ids).forEach((id) => t.member_ids.add(id));
  }

  for (const row of leaderRows) {
    const lid = String(row.user_id || '');
    if (!lid) continue;
    const objs = objectives.filter(
      (o) => String(o.leader_user_id || o.leader_User_id || '') === lid && String(o.scope || '').toLowerCase() === 'team'
    );
    if (!objs.length) {
      const name = `${row.full_name || 'Leader'} — cohort`;
      const t = ensureTeam(name, { synthetic: true });
      t.leader_ids.add(lid);
    }
  }

  const teamsRaw = [...teamsMap.values()].map((t) => {
    const leader_ids = [...t.leader_ids];
    const member_ids = [...t.member_ids].filter((id) => !t.leader_ids.has(id));
    const allHeadcountIds = new Set([...leader_ids, ...member_ids]);

    const leaders = leader_ids.map((id) => {
      const snap = personSnapshot(scoreByUserId.get(id), tenantUserById.get(id));
      return snap ? { ...snap, role: 'leader' } : null;
    }).filter(Boolean);

    const members = member_ids.map((id) => {
      const snap = personSnapshot(scoreByUserId.get(id), tenantUserById.get(id));
      return snap ? { ...snap, role: 'member' } : null;
    }).filter(Boolean);

    const membersScored = members.filter((m) => m.productivity_total != null);
    const leadersScored = leaders.filter((l) => l.productivity_total != null);

    const members_sum = membersScored.reduce((s, m) => s + (m.productivity_total || 0), 0);
    const members_avg = membersScored.length ? Math.round((members_sum / membersScored.length) * 10) / 10 : 0;
    const leaders_sum = leadersScored.reduce((s, l) => s + (l.productivity_total || 0), 0);
    const leaders_avg = leadersScored.length ? Math.round((leaders_sum / leadersScored.length) * 10) / 10 : 0;

    const component_totals = emptyComponents();
    const component_member_totals = emptyComponents();
    const component_leader_totals = emptyComponents();

    for (const m of members) addComponents(component_member_totals, m.breakdown);
    for (const l of leaders) addComponents(component_leader_totals, l.breakdown);
    for (const id of allHeadcountIds) {
      const p = scoreByUserId.get(id);
      if (p) addComponents(component_totals, p.breakdown);
    }

    const leaderPulseEvents = leaders.flatMap((l) => l.breakdown?.dailyPulse?.events || []);
    const daily_pulse = pulseStatsFromEvents(leaderPulseEvents);

    const team_individual_total = members_sum;
    const team_leaders_total = leaders_sum;
    const team_composite_score = Math.round((members_sum + leaders_sum) * 10) / 10;
    const headcount_scored = membersScored.length + leadersScored.length;
    const team_average_per_capita = headcount_scored
      ? Math.round((team_composite_score / headcount_scored) * 10) / 10
      : 0;

    return {
      team_key: t.team_key,
      team_name: t.team_name,
      synthetic: Boolean(t.synthetic),
      objective_count: t.objective_ids.length,
      shift_types: [...t.shift_types],
      leader_ids,
      member_ids,
      headcount: allHeadcountIds.size,
      headcount_scored,
      leaders,
      members,
      members_sum: Math.round(members_sum * 10) / 10,
      members_avg,
      leaders_sum: Math.round(leaders_sum * 10) / 10,
      leaders_avg,
      team_individual_total: Math.round(team_individual_total * 10) / 10,
      team_leaders_total: Math.round(team_leaders_total * 10) / 10,
      team_composite_score,
      team_average_per_capita,
      component_totals,
      component_member_totals,
      component_leader_totals,
      daily_pulse,
    };
  });

  teamsRaw.sort((a, b) => b.team_composite_score - a.team_composite_score);
  const orgComposites = teamsRaw.map((t) => t.team_composite_score).filter((x) => Number.isFinite(x));
  const org_average_composite = orgComposites.length
    ? Math.round((orgComposites.reduce((a, b) => a + b, 0) / orgComposites.length) * 10) / 10
    : 0;

  let pulseOn = 0;
  let pulseMissed = 0;
  for (const t of teamsRaw) {
    pulseOn += t.daily_pulse.on_time;
    pulseMissed += t.daily_pulse.missed;
  }
  const pulseDecided = pulseOn + pulseMissed;

  const teams = teamsRaw.map((t, i) => {
    const vs =
      org_average_composite !== 0
        ? Math.round(((t.team_composite_score - org_average_composite) / Math.abs(org_average_composite)) * 1000) / 10
        : 0;
    return {
      ...t,
      rank: i + 1,
      vs_org_average_pct: vs,
      performance_band:
        t.team_composite_score >= org_average_composite * 1.1
          ? 'leading'
          : t.team_composite_score >= org_average_composite * 0.9
            ? 'on_track'
            : 'attention',
    };
  });

  return {
    teams,
    org: {
      team_count: teams.length,
      average_composite: org_average_composite,
      top_team: teams[0]?.team_name || null,
      top_composite: teams[0]?.team_composite_score ?? 0,
      pulse_compliance_pct: pulseDecided ? Math.round((pulseOn / pulseDecided) * 1000) / 10 : null,
      pulse_on_time: pulseOn,
      pulse_missed: pulseMissed,
      total_members_scored: teams.reduce((s, t) => s + t.headcount_scored, 0),
    },
  };
}
