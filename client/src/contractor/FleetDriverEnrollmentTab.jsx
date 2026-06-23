import { useState, useEffect, useMemo, useCallback } from 'react';
import { contractor as contractorApi } from '../api';
import { formatTruckRegistration } from '../lib/truckKey.js';
import { hasFacilityAccess, isFleetDistributionEligible, sameEntityId } from '../lib/fleetEligibility.js';
import ListFiltersBar, { FilterField, FILTER_INPUT_CLASS } from '../components/ListFiltersBar.jsx';

const INTEGRATION_STATUS_LABELS = {
  facility: { label: 'Facility access', className: 'bg-green-100 text-green-800' },
  pending_cc: { label: 'Pending Command Centre', className: 'bg-amber-100 text-amber-800' },
  pending_contractor: { label: 'Awaiting contractor', className: 'bg-violet-100 text-violet-800' },
  declined: { label: 'Declined', className: 'bg-red-100 text-red-800' },
  pending_changes: { label: 'Pending changes', className: 'bg-red-100 text-red-800 border border-red-300' },
};

function classifyIntegrationStatus(entity) {
  if (entity?.has_pending_change || entity?.pending_change?.id) return 'pending_changes';
  if (entity?.facility_access) return 'facility';
  if (entity?.last_decline_reason) return 'declined';
  const cas = entity?.contractor_approval_status ?? entity?.contractorApprovalStatus;
  if (cas === 'declined_contractor') return 'declined';
  if (cas === 'pending_contractor') return 'pending_contractor';
  return 'pending_cc';
}

function getFacilityApprovedAt(row) {
  const raw = row?.facility_approved_at ?? row?.facilityApprovedAt ?? row?.reviewed_at ?? row?.reviewedAt ?? null;
  if (raw == null || raw === '') return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw.toISOString();
  if (typeof raw === 'object' && typeof raw.toISOString === 'function') {
    const iso = raw.toISOString();
    return iso === 'Invalid Date' ? null : iso;
  }
  return String(raw);
}

function getFacilityApprovedBy(row) {
  const raw = row?.facility_approved_by_name ?? row?.facilityApprovedByName ?? row?.reviewer_name ?? row?.reviewerName ?? null;
  return raw != null && String(raw).trim() !== '' ? String(raw).trim() : null;
}

function formatDateTime(value) {
  const raw = value != null && typeof value === 'object' && !(value instanceof Date)
    ? getFacilityApprovedAt(value)
    : value;
  if (raw == null || raw === '') return '—';
  const dt = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function matchesApprovedDateRange(row, from, to) {
  if (!from && !to) return true;
  const at = getFacilityApprovedAt(row);
  if (!at) return false;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return false;
  if (from) {
    const start = new Date(`${from}T00:00:00`);
    if (d < start) return false;
  }
  if (to) {
    const end = new Date(`${to}T23:59:59`);
    if (d > end) return false;
  }
  return true;
}

function applyEnrollmentFilters(rows, {
  haystackFn,
  search,
  mainContractor,
  subContractor,
  approvedBy,
  approvedFrom,
  approvedTo,
}) {
  const q = (search || '').trim().toLowerCase();
  return rows.filter((row) => {
    if (q && !haystackFn(row).includes(q)) return false;
    if (mainContractor && mainContractorLabel(row) !== mainContractor) return false;
    if (subContractor && subContractorLabel(row) !== subContractor) return false;
    if (approvedBy && (getFacilityApprovedBy(row) || '') !== approvedBy) return false;
    if (!matchesApprovedDateRange(row, approvedFrom, approvedTo)) return false;
    return true;
  });
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function mainContractorLabel(row) {
  return row?.main_contractor_display || row?.main_contractor || row?.contractor_company_name || '—';
}

function subContractorLabel(row) {
  return row?.sub_contractor_display || row?.sub_contractor || '—';
}

function StatusBadge({ entity }) {
  if (isFleetDistributionEligible(entity)) {
    return (
      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-green-100 text-green-800">
        Facility access
      </span>
    );
  }
  const statusKey = classifyIntegrationStatus(entity);
  const meta = INTEGRATION_STATUS_LABELS[statusKey] || { label: 'Not on distribution', className: 'bg-amber-100 text-amber-800' };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${meta.className}`}>
      {meta.label}
    </span>
  );
}

function buildEnrollmentFilterPills(values, setters) {
  const pills = [];
  if (values.mainContractor) {
    pills.push({ key: 'main', label: `Main contractor: ${values.mainContractor}`, onClear: () => setters.setMainContractor('') });
  }
  if (values.subContractor) {
    pills.push({ key: 'sub', label: `Sub-contractor: ${values.subContractor}`, onClear: () => setters.setSubContractor('') });
  }
  if (values.approvedBy) {
    pills.push({ key: 'by', label: `Approved by: ${values.approvedBy}`, onClear: () => setters.setApprovedBy('') });
  }
  if (values.approvedFrom) {
    pills.push({ key: 'from', label: `From: ${values.approvedFrom}`, onClear: () => setters.setApprovedFrom('') });
  }
  if (values.approvedTo) {
    pills.push({ key: 'to', label: `To: ${values.approvedTo}`, onClear: () => setters.setApprovedTo('') });
  }
  return pills;
}

function EnrollmentTableShell({ title, count, filteredCount, toolbar, filtersBar, children }) {
  return (
    <div className="app-glass-card overflow-hidden">
      <div className="px-5 py-4 border-b border-surface-200 bg-surface-50/80 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-surface-900">{title}</h3>
          <p className="text-xs text-surface-500 mt-0.5 tabular-nums">
            {filteredCount != null && filteredCount !== count
              ? `${filteredCount} shown · ${count} facility-approved on route`
              : `${count} facility-approved on route`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">{toolbar}</div>
      </div>
      <div className="p-4 border-b border-surface-100 bg-white/50">
        {filtersBar}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

function EnrollmentFilterFields({
  opts,
  mainContractor,
  onMainContractor,
  subContractor,
  onSubContractor,
  approvedBy,
  onApprovedBy,
  approvedFrom,
  onApprovedFrom,
  approvedTo,
  onApprovedTo,
}) {
  return (
    <>
      <FilterField label="Main contractor">
        <select value={mainContractor} onChange={(e) => onMainContractor(e.target.value)} className={FILTER_INPUT_CLASS}>
          <option value="">All contractors</option>
          {opts.mainContractors.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </FilterField>
      <FilterField label="Sub-contractor">
        <select value={subContractor} onChange={(e) => onSubContractor(e.target.value)} className={FILTER_INPUT_CLASS}>
          <option value="">All sub-contractors</option>
          {opts.subContractors.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </FilterField>
      <FilterField label="Approved by">
        <select value={approvedBy} onChange={(e) => onApprovedBy(e.target.value)} className={FILTER_INPUT_CLASS}>
          <option value="">All approvers</option>
          {opts.approvedBy.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </FilterField>
      <FilterField label="Approved from">
        <input type="date" value={approvedFrom} onChange={(e) => onApprovedFrom(e.target.value)} className={FILTER_INPUT_CLASS} />
      </FilterField>
      <FilterField label="Approved to">
        <input type="date" value={approvedTo} onChange={(e) => onApprovedTo(e.target.value)} className={FILTER_INPUT_CLASS} />
      </FilterField>
    </>
  );
}

export default function FleetDriverEnrollmentTab({ routesList, pageRestrictions, selectedContractorId, onError }) {
  const enrollmentRouteSearchMinChars = 2;
  const [enrollmentRouteId, setEnrollmentRouteId] = useState(null);
  const [enrollmentRouteDetail, setEnrollmentRouteDetail] = useState(null);
  const [enrollmentApprovedTrucks, setEnrollmentApprovedTrucks] = useState([]);
  const [enrollmentApprovedDrivers, setEnrollmentApprovedDrivers] = useState([]);
  const [enrollmentLoading, setEnrollmentLoading] = useState(false);
  const [enrollmentRoutePickerQuery, setEnrollmentRoutePickerQuery] = useState('');
  const [enrollmentInnerTab, setEnrollmentInnerTab] = useState('trucks');
  const [enrollmentAddTruckOpen, setEnrollmentAddTruckOpen] = useState(false);
  const [enrollmentAddDriverOpen, setEnrollmentAddDriverOpen] = useState(false);
  const [enrollmentSelectedTruckIds, setEnrollmentSelectedTruckIds] = useState([]);
  const [enrollmentSelectedDriverIds, setEnrollmentSelectedDriverIds] = useState([]);
  const [enrollmentEnrollingTrucks, setEnrollmentEnrollingTrucks] = useState(false);
  const [enrollmentEnrollingDrivers, setEnrollmentEnrollingDrivers] = useState(false);
  const [enrollmentSelectedRouteTruckIds, setEnrollmentSelectedRouteTruckIds] = useState([]);
  const [enrollmentSelectedRouteDriverIds, setEnrollmentSelectedRouteDriverIds] = useState([]);
  const [enrollmentUnenrollingTrucks, setEnrollmentUnenrollingTrucks] = useState(false);
  const [enrollmentUnenrollingDrivers, setEnrollmentUnenrollingDrivers] = useState(false);
  const [enrollmentRouteTruckSearch, setEnrollmentRouteTruckSearch] = useState('');
  const [enrollmentRouteDriverSearch, setEnrollmentRouteDriverSearch] = useState('');
  const [enrollmentApprovedTruckSearch, setEnrollmentApprovedTruckSearch] = useState('');
  const [enrollmentApprovedDriverSearch, setEnrollmentApprovedDriverSearch] = useState('');
  const [showTruckAdvancedFilters, setShowTruckAdvancedFilters] = useState(false);
  const [showDriverAdvancedFilters, setShowDriverAdvancedFilters] = useState(false);
  const [truckFilterMainContractor, setTruckFilterMainContractor] = useState('');
  const [truckFilterSubContractor, setTruckFilterSubContractor] = useState('');
  const [truckFilterApprovedBy, setTruckFilterApprovedBy] = useState('');
  const [truckFilterApprovedFrom, setTruckFilterApprovedFrom] = useState('');
  const [truckFilterApprovedTo, setTruckFilterApprovedTo] = useState('');
  const [driverFilterMainContractor, setDriverFilterMainContractor] = useState('');
  const [driverFilterSubContractor, setDriverFilterSubContractor] = useState('');
  const [driverFilterApprovedBy, setDriverFilterApprovedBy] = useState('');
  const [driverFilterApprovedFrom, setDriverFilterApprovedFrom] = useState('');
  const [driverFilterApprovedTo, setDriverFilterApprovedTo] = useState('');

  const enrollmentContractorQuery = useCallback(() => ({
    enrollmentPortal: '1',
    ...(selectedContractorId ? { contractor_id: selectedContractorId } : {}),
  }), [selectedContractorId]);

  const refreshEnrollmentRouteDetail = useCallback(async () => {
    if (!enrollmentRouteId) return;
    const r = await contractorApi.routes.get(enrollmentRouteId, enrollmentContractorQuery());
    setEnrollmentRouteDetail(r);
  }, [enrollmentRouteId, enrollmentContractorQuery]);

  const enrollmentRouteMatches = useMemo(() => {
    const q = enrollmentRoutePickerQuery.trim().toLowerCase();
    let list = routesList || [];
    if (q.length >= enrollmentRouteSearchMinChars) {
      list = list.filter((r) => {
        const hay = [
          r.name, r.loading_address, r.destination_address,
          r.starting_point, r.destination,
        ].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
      });
    } else {
      list = [];
    }
    if (enrollmentRouteId) {
      const selected = (routesList || []).find((r) => String(r.id) === String(enrollmentRouteId));
      if (selected && !list.some((r) => String(r.id) === String(enrollmentRouteId))) {
        list = [selected, ...list];
      }
    }
    return list;
  }, [routesList, enrollmentRoutePickerQuery, enrollmentRouteId]);

  const selectedRouteName = useMemo(
    () => (routesList || []).find((x) => String(x.id) === String(enrollmentRouteId))?.name || 'Route',
    [routesList, enrollmentRouteId]
  );

  useEffect(() => {
    let cancelled = false;
    setEnrollmentLoading(true);
    const cOpt = selectedContractorId || undefined;
    const portalOpts = { enrollmentPortal: '1' };
    Promise.all([
      contractorApi.enrollment.approvedTrucks(cOpt, portalOpts).then((r) => r.trucks || []),
      contractorApi.enrollment.approvedDrivers(cOpt, portalOpts).then((r) => r.drivers || []),
    ])
      .then(([trucks, drivers]) => {
        if (!cancelled) {
          setEnrollmentApprovedTrucks((trucks || []).filter((t) => hasFacilityAccess(t) && isFleetDistributionEligible(t)));
          setEnrollmentApprovedDrivers((drivers || []).filter((d) => hasFacilityAccess(d) && isFleetDistributionEligible(d)));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEnrollmentApprovedTrucks([]);
          setEnrollmentApprovedDrivers([]);
        }
      })
      .finally(() => { if (!cancelled) setEnrollmentLoading(false); });
    return () => { cancelled = true; };
  }, [selectedContractorId]);

  useEffect(() => {
    if (!enrollmentRouteId) {
      setEnrollmentRouteDetail(null);
      setEnrollmentSelectedRouteTruckIds([]);
      setEnrollmentSelectedRouteDriverIds([]);
      return;
    }
    let cancelled = false;
    contractorApi.routes.get(enrollmentRouteId, enrollmentContractorQuery())
      .then((r) => { if (!cancelled) setEnrollmentRouteDetail(r); })
      .catch(() => { if (!cancelled) setEnrollmentRouteDetail(null); });
    return () => { cancelled = true; };
  }, [enrollmentRouteId, selectedContractorId, enrollmentContractorQuery]);

  const truckHaystack = (t) => [
    t.registration, t.trailer_1_reg_no, t.trailer_2_reg_no, t.make_model, t.fleet_no,
    mainContractorLabel(t), subContractorLabel(t), getFacilityApprovedBy(t),
  ].filter(Boolean).join(' ').toLowerCase();

  const driverHaystack = (d) => [
    d.full_name, d.license_number, mainContractorLabel(d), subContractorLabel(d), getFacilityApprovedBy(d),
  ].filter(Boolean).join(' ').toLowerCase();

  const facilityApprovedRouteTrucks = (enrollmentRouteDetail?.trucks || []).filter(
    (t) => hasFacilityAccess(t) && isFleetDistributionEligible(t)
  );
  const facilityApprovedRouteDrivers = (enrollmentRouteDetail?.drivers || []).filter(
    (d) => hasFacilityAccess(d) && isFleetDistributionEligible(d)
  );

  const truckFilterOpts = useMemo(() => ({
    mainContractors: uniqueSorted(facilityApprovedRouteTrucks.map(mainContractorLabel)),
    subContractors: uniqueSorted(facilityApprovedRouteTrucks.map(subContractorLabel)),
    approvedBy: uniqueSorted(facilityApprovedRouteTrucks.map((t) => getFacilityApprovedBy(t))),
  }), [facilityApprovedRouteTrucks]);

  const driverFilterOpts = useMemo(() => ({
    mainContractors: uniqueSorted(facilityApprovedRouteDrivers.map(mainContractorLabel)),
    subContractors: uniqueSorted(facilityApprovedRouteDrivers.map(subContractorLabel)),
    approvedBy: uniqueSorted(facilityApprovedRouteDrivers.map((d) => getFacilityApprovedBy(d))),
  }), [facilityApprovedRouteDrivers]);

  const approvedTruckFilterOpts = useMemo(() => ({
    mainContractors: uniqueSorted(enrollmentApprovedTrucks.map(mainContractorLabel)),
    subContractors: uniqueSorted(enrollmentApprovedTrucks.map(subContractorLabel)),
    approvedBy: uniqueSorted(enrollmentApprovedTrucks.map((t) => getFacilityApprovedBy(t))),
  }), [enrollmentApprovedTrucks]);

  const approvedDriverFilterOpts = useMemo(() => ({
    mainContractors: uniqueSorted(enrollmentApprovedDrivers.map(mainContractorLabel)),
    subContractors: uniqueSorted(enrollmentApprovedDrivers.map(subContractorLabel)),
    approvedBy: uniqueSorted(enrollmentApprovedDrivers.map((d) => getFacilityApprovedBy(d))),
  }), [enrollmentApprovedDrivers]);

  const truckAdvancedActiveCount = [
    truckFilterMainContractor,
    truckFilterSubContractor,
    truckFilterApprovedBy,
    truckFilterApprovedFrom,
    truckFilterApprovedTo,
  ].filter(Boolean).length;

  const driverAdvancedActiveCount = [
    driverFilterMainContractor,
    driverFilterSubContractor,
    driverFilterApprovedBy,
    driverFilterApprovedFrom,
    driverFilterApprovedTo,
  ].filter(Boolean).length;

  const filteredEnrollmentRouteTrucks = applyEnrollmentFilters(facilityApprovedRouteTrucks, {
    haystackFn: truckHaystack,
    search: enrollmentRouteTruckSearch,
    mainContractor: truckFilterMainContractor,
    subContractor: truckFilterSubContractor,
    approvedBy: truckFilterApprovedBy,
    approvedFrom: truckFilterApprovedFrom,
    approvedTo: truckFilterApprovedTo,
  });

  const filteredEnrollmentRouteDrivers = applyEnrollmentFilters(facilityApprovedRouteDrivers, {
    haystackFn: driverHaystack,
    search: enrollmentRouteDriverSearch,
    mainContractor: driverFilterMainContractor,
    subContractor: driverFilterSubContractor,
    approvedBy: driverFilterApprovedBy,
    approvedFrom: driverFilterApprovedFrom,
    approvedTo: driverFilterApprovedTo,
  });

  const filteredEnrollmentApprovedTrucks = applyEnrollmentFilters(enrollmentApprovedTrucks, {
    haystackFn: truckHaystack,
    search: enrollmentApprovedTruckSearch,
    mainContractor: truckFilterMainContractor,
    subContractor: truckFilterSubContractor,
    approvedBy: truckFilterApprovedBy,
    approvedFrom: truckFilterApprovedFrom,
    approvedTo: truckFilterApprovedTo,
  });

  const filteredEnrollmentApprovedDrivers = applyEnrollmentFilters(enrollmentApprovedDrivers, {
    haystackFn: driverHaystack,
    search: enrollmentApprovedDriverSearch,
    mainContractor: driverFilterMainContractor,
    subContractor: driverFilterSubContractor,
    approvedBy: driverFilterApprovedBy,
    approvedFrom: driverFilterApprovedFrom,
    approvedTo: driverFilterApprovedTo,
  });

  const routeTruckCount = facilityApprovedRouteTrucks.length;
  const routeDriverCount = facilityApprovedRouteDrivers.length;

  const clearTruckAdvancedFilters = () => {
    setTruckFilterMainContractor('');
    setTruckFilterSubContractor('');
    setTruckFilterApprovedBy('');
    setTruckFilterApprovedFrom('');
    setTruckFilterApprovedTo('');
  };

  const clearDriverAdvancedFilters = () => {
    setDriverFilterMainContractor('');
    setDriverFilterSubContractor('');
    setDriverFilterApprovedBy('');
    setDriverFilterApprovedFrom('');
    setDriverFilterApprovedTo('');
  };

  const resetRouteEnrollment = () => {
    setEnrollmentRouteId(null);
    setEnrollmentRouteDetail(null);
    setEnrollmentRouteTruckSearch('');
    setEnrollmentRouteDriverSearch('');
    setEnrollmentSelectedRouteTruckIds([]);
    setEnrollmentSelectedRouteDriverIds([]);
    clearTruckAdvancedFilters();
    clearDriverAdvancedFilters();
    setShowTruckAdvancedFilters(false);
    setShowDriverAdvancedFilters(false);
  };

  const truckFilterValues = {
    mainContractor: truckFilterMainContractor,
    subContractor: truckFilterSubContractor,
    approvedBy: truckFilterApprovedBy,
    approvedFrom: truckFilterApprovedFrom,
    approvedTo: truckFilterApprovedTo,
  };
  const truckFilterSetters = {
    setMainContractor: setTruckFilterMainContractor,
    setSubContractor: setTruckFilterSubContractor,
    setApprovedBy: setTruckFilterApprovedBy,
    setApprovedFrom: setTruckFilterApprovedFrom,
    setApprovedTo: setTruckFilterApprovedTo,
  };
  const driverFilterValues = {
    mainContractor: driverFilterMainContractor,
    subContractor: driverFilterSubContractor,
    approvedBy: driverFilterApprovedBy,
    approvedFrom: driverFilterApprovedFrom,
    approvedTo: driverFilterApprovedTo,
  };
  const driverFilterSetters = {
    setMainContractor: setDriverFilterMainContractor,
    setSubContractor: setDriverFilterSubContractor,
    setApprovedBy: setDriverFilterApprovedBy,
    setApprovedFrom: setDriverFilterApprovedFrom,
    setApprovedTo: setDriverFilterApprovedTo,
  };

  const clearTruckFiltersAll = () => {
    clearTruckAdvancedFilters();
    setEnrollmentRouteTruckSearch('');
    setEnrollmentApprovedTruckSearch('');
  };

  const clearDriverFiltersAll = () => {
    clearDriverAdvancedFilters();
    setEnrollmentRouteDriverSearch('');
    setEnrollmentApprovedDriverSearch('');
  };

  const truckFiltersBar = (
    <ListFiltersBar
      search={enrollmentRouteTruckSearch}
      onSearch={setEnrollmentRouteTruckSearch}
      searchPlaceholder="Registration, trailer, contractor, approver…"
      showAdvanced={showTruckAdvancedFilters}
      onToggleAdvanced={() => setShowTruckAdvancedFilters((v) => !v)}
      activeCount={truckAdvancedActiveCount}
      activePills={buildEnrollmentFilterPills(truckFilterValues, truckFilterSetters)}
      onClearAll={clearTruckFiltersAll}
      onClearSearch={() => setEnrollmentRouteTruckSearch('')}
    >
      <EnrollmentFilterFields
        opts={truckFilterOpts}
        mainContractor={truckFilterMainContractor}
        onMainContractor={setTruckFilterMainContractor}
        subContractor={truckFilterSubContractor}
        onSubContractor={setTruckFilterSubContractor}
        approvedBy={truckFilterApprovedBy}
        onApprovedBy={setTruckFilterApprovedBy}
        approvedFrom={truckFilterApprovedFrom}
        onApprovedFrom={setTruckFilterApprovedFrom}
        approvedTo={truckFilterApprovedTo}
        onApprovedTo={setTruckFilterApprovedTo}
      />
    </ListFiltersBar>
  );

  const driverFiltersBar = (
    <ListFiltersBar
      search={enrollmentRouteDriverSearch}
      onSearch={setEnrollmentRouteDriverSearch}
      searchPlaceholder="Name, licence, contractor, approver…"
      showAdvanced={showDriverAdvancedFilters}
      onToggleAdvanced={() => setShowDriverAdvancedFilters((v) => !v)}
      activeCount={driverAdvancedActiveCount}
      activePills={buildEnrollmentFilterPills(driverFilterValues, driverFilterSetters)}
      onClearAll={clearDriverFiltersAll}
      onClearSearch={() => setEnrollmentRouteDriverSearch('')}
    >
      <EnrollmentFilterFields
        opts={driverFilterOpts}
        mainContractor={driverFilterMainContractor}
        onMainContractor={setDriverFilterMainContractor}
        subContractor={driverFilterSubContractor}
        onSubContractor={setDriverFilterSubContractor}
        approvedBy={driverFilterApprovedBy}
        onApprovedBy={setDriverFilterApprovedBy}
        approvedFrom={driverFilterApprovedFrom}
        onApprovedFrom={setDriverFilterApprovedFrom}
        approvedTo={driverFilterApprovedTo}
        onApprovedTo={setDriverFilterApprovedTo}
      />
    </ListFiltersBar>
  );

  const modalTruckFiltersBar = (
    <ListFiltersBar
      compact
      search={enrollmentApprovedTruckSearch}
      onSearch={setEnrollmentApprovedTruckSearch}
      searchPlaceholder="Search available trucks…"
      showAdvanced={showTruckAdvancedFilters}
      onToggleAdvanced={() => setShowTruckAdvancedFilters((v) => !v)}
      activeCount={truckAdvancedActiveCount}
      activePills={buildEnrollmentFilterPills(truckFilterValues, truckFilterSetters)}
      onClearAll={clearTruckFiltersAll}
      onClearSearch={() => setEnrollmentApprovedTruckSearch('')}
      resultSummary={`${filteredEnrollmentApprovedTrucks.length} available`}
    >
      <EnrollmentFilterFields
        opts={approvedTruckFilterOpts}
        mainContractor={truckFilterMainContractor}
        onMainContractor={setTruckFilterMainContractor}
        subContractor={truckFilterSubContractor}
        onSubContractor={setTruckFilterSubContractor}
        approvedBy={truckFilterApprovedBy}
        onApprovedBy={setTruckFilterApprovedBy}
        approvedFrom={truckFilterApprovedFrom}
        onApprovedFrom={setTruckFilterApprovedFrom}
        approvedTo={truckFilterApprovedTo}
        onApprovedTo={setTruckFilterApprovedTo}
      />
    </ListFiltersBar>
  );

  const modalDriverFiltersBar = (
    <ListFiltersBar
      compact
      search={enrollmentApprovedDriverSearch}
      onSearch={setEnrollmentApprovedDriverSearch}
      searchPlaceholder="Search available drivers…"
      showAdvanced={showDriverAdvancedFilters}
      onToggleAdvanced={() => setShowDriverAdvancedFilters((v) => !v)}
      activeCount={driverAdvancedActiveCount}
      activePills={buildEnrollmentFilterPills(driverFilterValues, driverFilterSetters)}
      onClearAll={clearDriverFiltersAll}
      onClearSearch={() => setEnrollmentApprovedDriverSearch('')}
      resultSummary={`${filteredEnrollmentApprovedDrivers.length} available`}
    >
      <EnrollmentFilterFields
        opts={approvedDriverFilterOpts}
        mainContractor={driverFilterMainContractor}
        onMainContractor={setDriverFilterMainContractor}
        subContractor={driverFilterSubContractor}
        onSubContractor={setDriverFilterSubContractor}
        approvedBy={driverFilterApprovedBy}
        onApprovedBy={setDriverFilterApprovedBy}
        approvedFrom={driverFilterApprovedFrom}
        onApprovedFrom={setDriverFilterApprovedFrom}
        approvedTo={driverFilterApprovedTo}
        onApprovedTo={setDriverFilterApprovedTo}
      />
    </ListFiltersBar>
  );

  const clearRouteSelection = () => {
    resetRouteEnrollment();
    setEnrollmentRoutePickerQuery('');
  };

  const truckToolbar = (
    <>
      {filteredEnrollmentRouteTrucks.length > 0 && (
        <>
          <button type="button" onClick={() => setEnrollmentSelectedRouteTruckIds(filteredEnrollmentRouteTrucks.map((t) => t.truck_id))} className="text-xs font-medium text-brand-600 hover:underline">Select all</button>
          <button type="button" onClick={() => setEnrollmentSelectedRouteTruckIds([])} className="text-xs font-medium text-surface-500 hover:underline">Clear</button>
          <button
            type="button"
            disabled={!pageRestrictions.allow_enrollment || enrollmentSelectedRouteTruckIds.length === 0 || enrollmentUnenrollingTrucks}
            onClick={async () => {
              if (!enrollmentRouteId || enrollmentSelectedRouteTruckIds.length === 0) return;
              setEnrollmentUnenrollingTrucks(true);
              try {
                await contractorApi.routes.unenrollTrucksBulk(enrollmentRouteId, enrollmentSelectedRouteTruckIds);
                setEnrollmentSelectedRouteTruckIds([]);
                await refreshEnrollmentRouteDetail();
              } catch (e) {
                onError?.(e?.message);
              } finally {
                setEnrollmentUnenrollingTrucks(false);
              }
            }}
            className="px-2.5 py-1.5 text-xs rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            {enrollmentUnenrollingTrucks ? 'Removing…' : `Remove (${enrollmentSelectedRouteTruckIds.length})`}
          </button>
        </>
      )}
      <button
        type="button"
        onClick={() => setEnrollmentAddTruckOpen(true)}
        disabled={!pageRestrictions.allow_enrollment}
        className="px-3 py-1.5 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
      >
        Enrol trucks
      </button>
    </>
  );

  const driverToolbar = (
    <>
      {filteredEnrollmentRouteDrivers.length > 0 && (
        <>
          <button type="button" onClick={() => setEnrollmentSelectedRouteDriverIds(filteredEnrollmentRouteDrivers.map((d) => d.driver_id))} className="text-xs font-medium text-brand-600 hover:underline">Select all</button>
          <button type="button" onClick={() => setEnrollmentSelectedRouteDriverIds([])} className="text-xs font-medium text-surface-500 hover:underline">Clear</button>
          <button
            type="button"
            disabled={!pageRestrictions.allow_enrollment || enrollmentSelectedRouteDriverIds.length === 0 || enrollmentUnenrollingDrivers}
            onClick={async () => {
              if (!enrollmentRouteId || enrollmentSelectedRouteDriverIds.length === 0) return;
              setEnrollmentUnenrollingDrivers(true);
              try {
                await contractorApi.routes.unenrollDriversBulk(enrollmentRouteId, enrollmentSelectedRouteDriverIds);
                setEnrollmentSelectedRouteDriverIds([]);
                await refreshEnrollmentRouteDetail();
              } catch (e) {
                onError?.(e?.message);
              } finally {
                setEnrollmentUnenrollingDrivers(false);
              }
            }}
            className="px-2.5 py-1.5 text-xs rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            {enrollmentUnenrollingDrivers ? 'Removing…' : `Remove (${enrollmentSelectedRouteDriverIds.length})`}
          </button>
        </>
      )}
      <button
        type="button"
        onClick={() => setEnrollmentAddDriverOpen(true)}
        disabled={!pageRestrictions.allow_enrollment}
        className="px-3 py-1.5 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
      >
        Enrol drivers
      </button>
    </>
  );

  return (
    <div className="w-full space-y-6">
      <div className="app-glass-card p-5">
        <h2 className="text-lg font-semibold text-surface-900">Fleet and driver enrollment</h2>
        <p className="text-sm text-surface-500 mt-1 max-w-3xl">
          Search and select a route, then manage enrolled trucks and drivers on separate tabs. Only facility-approved fleet can be enrolled; approval date and approver are shown for each record.
        </p>
      </div>

      {!pageRestrictions.allow_enrollment && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 max-w-3xl">
          Enrollment actions are restricted by Access Management.
        </p>
      )}

      {routesList.length === 0 ? (
        <p className="text-sm text-surface-500">No routes yet. Routes are created in Access Management.</p>
      ) : (
        <div className="rounded-xl border border-surface-200 bg-white p-5 shadow-sm max-w-2xl space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-surface-900">Select route</h3>
            <p className="text-xs text-surface-500 mt-0.5">Search by route name or endpoints, then choose a route to manage enrollment.</p>
          </div>
          <FilterField label="Search routes">
            <input
              id="enrollment-route-search"
              type="search"
              autoComplete="off"
              value={enrollmentRoutePickerQuery}
              onChange={(e) => {
                setEnrollmentRoutePickerQuery(e.target.value);
                resetRouteEnrollment();
              }}
              placeholder="Route name, start, or destination…"
              className={FILTER_INPUT_CLASS}
            />
          </FilterField>
          <p className="text-[11px] text-surface-400 -mt-2">Type at least {enrollmentRouteSearchMinChars} characters to search.</p>
          <FilterField label="Route">
            <select
              id="enrollment-route-select"
              value={enrollmentRouteId || ''}
              disabled={enrollmentRouteMatches.length === 0}
              onChange={(e) => {
                setEnrollmentRouteId(e.target.value || null);
                setEnrollmentRouteTruckSearch('');
                setEnrollmentRouteDriverSearch('');
                setEnrollmentInnerTab('trucks');
                clearTruckAdvancedFilters();
                clearDriverAdvancedFilters();
                setShowTruckAdvancedFilters(false);
                setShowDriverAdvancedFilters(false);
              }}
              className={`${FILTER_INPUT_CLASS} disabled:bg-surface-50 disabled:text-surface-400`}
            >
              <option value="">
                {enrollmentRoutePickerQuery.trim().length < enrollmentRouteSearchMinChars
                  ? `Type at least ${enrollmentRouteSearchMinChars} characters…`
                  : enrollmentRouteMatches.length === 0
                    ? 'No routes match'
                    : 'Choose a route…'}
              </option>
              {enrollmentRouteMatches.map((r) => (
                <option key={r.id} value={r.id}>{r.name || 'Unnamed route'}</option>
              ))}
            </select>
          </FilterField>
        </div>
      )}

      {enrollmentLoading && <p className="text-sm text-surface-500">Loading approved fleet…</p>}

      {enrollmentRouteId && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-surface-600">
                Route: <strong className="text-surface-900">{selectedRouteName}</strong>
              </p>
              <p className="text-xs text-surface-500 mt-0.5">{routeTruckCount} trucks · {routeDriverCount} drivers enrolled</p>
            </div>
            <button type="button" onClick={clearRouteSelection} className="text-xs font-medium text-brand-600 hover:underline">
              Change route
            </button>
          </div>

          <div className="flex gap-1 border-b border-surface-200">
            {[
              { id: 'trucks', label: 'Trucks on route', count: routeTruckCount },
              { id: 'drivers', label: 'Drivers on route', count: routeDriverCount },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setEnrollmentInnerTab(tab.id)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  enrollmentInnerTab === tab.id
                    ? 'border-brand-600 text-brand-700'
                    : 'border-transparent text-surface-500 hover:text-surface-800'
                }`}
              >
                {tab.label}
                <span className="ml-1.5 text-xs tabular-nums text-surface-400">({tab.count})</span>
              </button>
            ))}
          </div>

          {enrollmentInnerTab === 'trucks' && (
            <EnrollmentTableShell
              title="Trucks on this route"
              count={routeTruckCount}
              filteredCount={filteredEnrollmentRouteTrucks.length}
              toolbar={truckToolbar}
              filtersBar={truckFiltersBar}
            >
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-50 text-left text-xs uppercase tracking-wide text-surface-500">
                    <th className="px-3 py-2 w-10" />
                    <th className="px-3 py-2 font-semibold">Truck</th>
                    <th className="px-3 py-2 font-semibold">Trailer 1</th>
                    <th className="px-3 py-2 font-semibold">Trailer 2</th>
                    <th className="px-3 py-2 font-semibold">Main contractor</th>
                    <th className="px-3 py-2 font-semibold">Sub-contractor</th>
                    <th className="px-3 py-2 font-semibold">Approved at</th>
                    <th className="px-3 py-2 font-semibold">Approved by</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 w-20" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100">
                  {filteredEnrollmentRouteTrucks.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-surface-500">
                        {routeTruckCount === 0 ? 'No trucks enrolled on this route.' : 'No trucks match your search or filters.'}
                      </td>
                    </tr>
                  ) : filteredEnrollmentRouteTrucks.map((t) => {
                    const id = t.truck_id;
                    const selected = enrollmentSelectedRouteTruckIds.some((x) => sameEntityId(x, id));
                    return (
                      <tr key={id} className="hover:bg-surface-50/60">
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => setEnrollmentSelectedRouteTruckIds((prev) =>
                              prev.some((x) => sameEntityId(x, id)) ? prev.filter((x) => !sameEntityId(x, id)) : [...prev, id]
                            )}
                            className="rounded border-surface-300 text-brand-600"
                          />
                        </td>
                        <td className="px-3 py-2 font-medium text-surface-900 whitespace-nowrap">
                          {formatTruckRegistration(t.registration) || '—'}
                          {t.fleet_no ? <span className="text-surface-500 font-normal"> · #{t.fleet_no}</span> : null}
                        </td>
                        <td className="px-3 py-2 text-surface-700 whitespace-nowrap">{formatTruckRegistration(t.trailer_1_reg_no) || '—'}</td>
                        <td className="px-3 py-2 text-surface-700 whitespace-nowrap">{formatTruckRegistration(t.trailer_2_reg_no) || '—'}</td>
                        <td className="px-3 py-2 text-surface-700 max-w-[140px] truncate" title={mainContractorLabel(t)}>{mainContractorLabel(t)}</td>
                        <td className="px-3 py-2 text-surface-700 max-w-[140px] truncate" title={subContractorLabel(t)}>{subContractorLabel(t)}</td>
                        <td className="px-3 py-2 text-surface-600 whitespace-nowrap">{formatDateTime(getFacilityApprovedAt(t))}</td>
                        <td className="px-3 py-2 text-surface-600 max-w-[120px] truncate" title={getFacilityApprovedBy(t) || ''}>{getFacilityApprovedBy(t) || '—'}</td>
                        <td className="px-3 py-2"><StatusBadge entity={t} /></td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            disabled={!pageRestrictions.allow_enrollment}
                            onClick={async () => {
                              try {
                                await contractorApi.routes.unenrollTruck(enrollmentRouteId, id);
                                setEnrollmentSelectedRouteTruckIds((prev) => prev.filter((x) => !sameEntityId(x, id)));
                                await refreshEnrollmentRouteDetail();
                              } catch (e) {
                                onError?.(e?.message);
                              }
                            }}
                            className="text-red-600 hover:text-red-700 text-xs disabled:opacity-40"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </EnrollmentTableShell>
          )}

          {enrollmentInnerTab === 'drivers' && (
            <EnrollmentTableShell
              title="Drivers on this route"
              count={routeDriverCount}
              filteredCount={filteredEnrollmentRouteDrivers.length}
              toolbar={driverToolbar}
              filtersBar={driverFiltersBar}
            >
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-50 text-left text-xs uppercase tracking-wide text-surface-500">
                    <th className="px-3 py-2 w-10" />
                    <th className="px-3 py-2 font-semibold">Driver</th>
                    <th className="px-3 py-2 font-semibold">Licence</th>
                    <th className="px-3 py-2 font-semibold">Main contractor</th>
                    <th className="px-3 py-2 font-semibold">Sub-contractor</th>
                    <th className="px-3 py-2 font-semibold">Approved at</th>
                    <th className="px-3 py-2 font-semibold">Approved by</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 w-20" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100">
                  {filteredEnrollmentRouteDrivers.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-surface-500">
                        {routeDriverCount === 0 ? 'No drivers enrolled on this route.' : 'No drivers match your search or filters.'}
                      </td>
                    </tr>
                  ) : filteredEnrollmentRouteDrivers.map((d) => {
                    const id = d.driver_id;
                    const selected = enrollmentSelectedRouteDriverIds.some((x) => sameEntityId(x, id));
                    return (
                      <tr key={id} className="hover:bg-surface-50/60">
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => setEnrollmentSelectedRouteDriverIds((prev) =>
                              prev.some((x) => sameEntityId(x, id)) ? prev.filter((x) => !sameEntityId(x, id)) : [...prev, id]
                            )}
                            className="rounded border-surface-300 text-brand-600"
                          />
                        </td>
                        <td className="px-3 py-2 font-medium text-surface-900">{d.full_name || '—'}</td>
                        <td className="px-3 py-2 text-surface-700">{d.license_number || '—'}</td>
                        <td className="px-3 py-2 text-surface-700 max-w-[140px] truncate" title={mainContractorLabel(d)}>{mainContractorLabel(d)}</td>
                        <td className="px-3 py-2 text-surface-700 max-w-[140px] truncate" title={subContractorLabel(d)}>{subContractorLabel(d)}</td>
                        <td className="px-3 py-2 text-surface-600 whitespace-nowrap">{formatDateTime(getFacilityApprovedAt(d))}</td>
                        <td className="px-3 py-2 text-surface-600 max-w-[120px] truncate" title={getFacilityApprovedBy(d) || ''}>{getFacilityApprovedBy(d) || '—'}</td>
                        <td className="px-3 py-2"><StatusBadge entity={d} /></td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            disabled={!pageRestrictions.allow_enrollment}
                            onClick={async () => {
                              try {
                                await contractorApi.routes.unenrollDriver(enrollmentRouteId, id);
                                setEnrollmentSelectedRouteDriverIds((prev) => prev.filter((x) => !sameEntityId(x, id)));
                                await refreshEnrollmentRouteDetail();
                              } catch (e) {
                                onError?.(e?.message);
                              }
                            }}
                            className="text-red-600 hover:text-red-700 text-xs disabled:opacity-40"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </EnrollmentTableShell>
          )}
        </>
      )}

      {enrollmentAddTruckOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { setEnrollmentAddTruckOpen(false); setEnrollmentSelectedTruckIds([]); setEnrollmentApprovedTruckSearch(''); }}>
          <div className="bg-white rounded-xl shadow-xl max-w-5xl w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-surface-200 flex justify-between items-center bg-surface-50">
              <div>
                <h3 className="font-semibold text-surface-900">Enrol trucks on route</h3>
                <p className="text-xs text-surface-500 mt-0.5">{selectedRouteName}</p>
              </div>
              <button type="button" onClick={() => { setEnrollmentAddTruckOpen(false); setEnrollmentSelectedTruckIds([]); setEnrollmentApprovedTruckSearch(''); }} className="text-surface-500 hover:text-surface-700 text-xl leading-none">×</button>
            </div>
            <div className="p-4 overflow-auto flex-1">
              {enrollmentApprovedTrucks.length === 0 ? (
                <p className="text-sm text-surface-500">No approved trucks available.</p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2 mb-4 px-1">
                    <button type="button" onClick={() => setEnrollmentSelectedTruckIds(enrollmentApprovedTrucks.filter((t) => !facilityApprovedRouteTrucks.some((e) => sameEntityId(e.truck_id, t.id))).map((t) => t.id))} className="text-xs font-semibold text-brand-700 hover:underline">Select all available</button>
                    <span className="text-surface-300">·</span>
                    <button type="button" onClick={() => setEnrollmentSelectedTruckIds([])} className="text-xs font-medium text-surface-500 hover:underline">Clear selection</button>
                    <span className="text-xs text-surface-500 ml-auto tabular-nums">{enrollmentSelectedTruckIds.length} selected</span>
                  </div>
                  {modalTruckFiltersBar}
                  <div className="overflow-x-auto border border-surface-200 rounded-lg mt-4">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-surface-50 text-left text-xs uppercase text-surface-500">
                          <th className="px-3 py-2 w-10" />
                          <th className="px-3 py-2">Truck</th>
                          <th className="px-3 py-2">Trailer 1</th>
                          <th className="px-3 py-2">Trailer 2</th>
                          <th className="px-3 py-2">Main contractor</th>
                          <th className="px-3 py-2">Sub-contractor</th>
                          <th className="px-3 py-2">Approved at</th>
                          <th className="px-3 py-2">Approved by</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-100">
                        {filteredEnrollmentApprovedTrucks.map((t) => {
                          const enrolled = facilityApprovedRouteTrucks.some((e) => sameEntityId(e.truck_id, t.id));
                          const selected = enrollmentSelectedTruckIds.some((id) => sameEntityId(id, t.id));
                          return (
                            <tr key={t.id} className={enrolled ? 'bg-surface-50 opacity-60' : ''}>
                              <td className="px-3 py-2">
                                <input type="checkbox" checked={selected} disabled={enrolled} onChange={() => { if (enrolled) return; setEnrollmentSelectedTruckIds((prev) => prev.some((id) => sameEntityId(id, t.id)) ? prev.filter((id) => !sameEntityId(id, t.id)) : [...prev, t.id]); }} className="rounded border-surface-300 text-brand-600" />
                              </td>
                              <td className="px-3 py-2 font-medium">{formatTruckRegistration(t.registration)}{enrolled ? <span className="ml-2 text-xs text-surface-500">Enrolled</span> : null}</td>
                              <td className="px-3 py-2">{formatTruckRegistration(t.trailer_1_reg_no) || '—'}</td>
                              <td className="px-3 py-2">{formatTruckRegistration(t.trailer_2_reg_no) || '—'}</td>
                              <td className="px-3 py-2">{mainContractorLabel(t)}</td>
                              <td className="px-3 py-2">{subContractorLabel(t)}</td>
                              <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(getFacilityApprovedAt(t))}</td>
                              <td className="px-3 py-2">{getFacilityApprovedBy(t) || '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-4 pt-4 border-t border-surface-200">
                    <button
                      type="button"
                      disabled={!pageRestrictions.allow_enrollment || enrollmentSelectedTruckIds.length === 0 || enrollmentEnrollingTrucks}
                      onClick={async () => {
                        if (!enrollmentRouteId || enrollmentSelectedTruckIds.length === 0) return;
                        setEnrollmentEnrollingTrucks(true);
                        try {
                          await contractorApi.routes.enrollTrucks(enrollmentRouteId, enrollmentSelectedTruckIds);
                          await refreshEnrollmentRouteDetail();
                          setEnrollmentSelectedTruckIds([]);
                          setEnrollmentAddTruckOpen(false);
                        } catch (e) {
                          onError?.(e?.message || 'Failed to enrol trucks');
                        } finally {
                          setEnrollmentEnrollingTrucks(false);
                        }
                      }}
                      className="w-full px-4 py-2.5 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
                    >
                      {enrollmentEnrollingTrucks ? 'Enrolling…' : `Enrol selected (${enrollmentSelectedTruckIds.length})`}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {enrollmentAddDriverOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { setEnrollmentAddDriverOpen(false); setEnrollmentSelectedDriverIds([]); setEnrollmentApprovedDriverSearch(''); }}>
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-surface-200 flex justify-between items-center bg-surface-50">
              <div>
                <h3 className="font-semibold text-surface-900">Enrol drivers on route</h3>
                <p className="text-xs text-surface-500 mt-0.5">{selectedRouteName}</p>
              </div>
              <button type="button" onClick={() => { setEnrollmentAddDriverOpen(false); setEnrollmentSelectedDriverIds([]); setEnrollmentApprovedDriverSearch(''); }} className="text-surface-500 hover:text-surface-700 text-xl leading-none">×</button>
            </div>
            <div className="p-4 overflow-auto flex-1">
              {enrollmentApprovedDrivers.length === 0 ? (
                <p className="text-sm text-surface-500">No approved drivers available.</p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2 mb-4 px-1">
                    <button type="button" onClick={() => setEnrollmentSelectedDriverIds(enrollmentApprovedDrivers.filter((d) => !facilityApprovedRouteDrivers.some((e) => sameEntityId(e.driver_id, d.id))).map((d) => d.id))} className="text-xs font-semibold text-brand-700 hover:underline">Select all available</button>
                    <span className="text-surface-300">·</span>
                    <button type="button" onClick={() => setEnrollmentSelectedDriverIds([])} className="text-xs font-medium text-surface-500 hover:underline">Clear selection</button>
                    <span className="text-xs text-surface-500 ml-auto tabular-nums">{enrollmentSelectedDriverIds.length} selected</span>
                  </div>
                  {modalDriverFiltersBar}
                  <div className="overflow-x-auto border border-surface-200 rounded-lg mt-4">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-surface-50 text-left text-xs uppercase text-surface-500">
                          <th className="px-3 py-2 w-10" />
                          <th className="px-3 py-2">Driver</th>
                          <th className="px-3 py-2">Licence</th>
                          <th className="px-3 py-2">Main contractor</th>
                          <th className="px-3 py-2">Sub-contractor</th>
                          <th className="px-3 py-2">Approved at</th>
                          <th className="px-3 py-2">Approved by</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-100">
                        {filteredEnrollmentApprovedDrivers.map((d) => {
                          const enrolled = facilityApprovedRouteDrivers.some((e) => sameEntityId(e.driver_id, d.id));
                          const selected = enrollmentSelectedDriverIds.some((id) => sameEntityId(id, d.id));
                          return (
                            <tr key={d.id} className={enrolled ? 'bg-surface-50 opacity-60' : ''}>
                              <td className="px-3 py-2">
                                <input type="checkbox" checked={selected} disabled={enrolled} onChange={() => { if (enrolled) return; setEnrollmentSelectedDriverIds((prev) => prev.some((id) => sameEntityId(id, d.id)) ? prev.filter((id) => !sameEntityId(id, d.id)) : [...prev, d.id]); }} className="rounded border-surface-300 text-brand-600" />
                              </td>
                              <td className="px-3 py-2 font-medium">{d.full_name}{enrolled ? <span className="ml-2 text-xs text-surface-500">Enrolled</span> : null}</td>
                              <td className="px-3 py-2">{d.license_number || '—'}</td>
                              <td className="px-3 py-2">{mainContractorLabel(d)}</td>
                              <td className="px-3 py-2">{subContractorLabel(d)}</td>
                              <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(getFacilityApprovedAt(d))}</td>
                              <td className="px-3 py-2">{getFacilityApprovedBy(d) || '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-4 pt-4 border-t border-surface-200">
                    <button
                      type="button"
                      disabled={!pageRestrictions.allow_enrollment || enrollmentSelectedDriverIds.length === 0 || enrollmentEnrollingDrivers}
                      onClick={async () => {
                        if (!enrollmentRouteId || enrollmentSelectedDriverIds.length === 0) return;
                        setEnrollmentEnrollingDrivers(true);
                        try {
                          await contractorApi.routes.enrollDrivers(enrollmentRouteId, enrollmentSelectedDriverIds);
                          await refreshEnrollmentRouteDetail();
                          setEnrollmentSelectedDriverIds([]);
                          setEnrollmentAddDriverOpen(false);
                        } catch (e) {
                          onError?.(e?.message || 'Failed to enrol drivers');
                        } finally {
                          setEnrollmentEnrollingDrivers(false);
                        }
                      }}
                      className="w-full px-4 py-2.5 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
                    >
                      {enrollmentEnrollingDrivers ? 'Enrolling…' : `Enrol selected (${enrollmentSelectedDriverIds.length})`}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
