# Tracking & integration — follow-ups (roadmap)

Some items below are still **future** work; others (maps v1, mock seed, live demo tick) are implemented for local demos — see **Demo / mock data**.

## Platform & security

- **Real telematics / weighbridge ingestion** — Background jobs for polling vendor APIs or receiving **webhooks**, normalizing payloads into `fleet_trip`, alarms, and delivery records.
- **Maps** — **Implemented (v1):** **Leaflet** + OpenStreetMap on **Tracking → Fleet movement** (`FleetLiveMap.jsx`): markers from trip `last_lat`/`last_lng`, corridor polyline when a monitor route has origin/destination coordinates. Optional **Live updates** runs `POST /tracking/demo/tick` on a timer (moves **MOCK-** trips only). Further: Mapbox styles, geofence overlays, richer routing.
- **Secrets** — Encrypt API keys/secrets at rest (e.g. **Azure Key Vault** or app-level encryption with keys in Key Vault); avoid plain `NVARCHAR` secrets in the DB for high-assurance tenants.

### Demo / mock data (local)

- `npm run db:tracking-mock` — Inserts three **MOCK-DEMO-*** en-route trips (Gauteng corridor), a demo provider, weighbridge, and monitor route. Re-run replaces previous MOCK-DEMO trips for the tenant.
- In the UI, enable **Live updates** to simulate streaming GPS for those MOCK trips only.

## Provider connectors (South Africa–focused + generic)

These names align with common fleet/telematics brands. Implementation work per vendor: auth, rate limits, vehicle list, positions, events, and (where offered) weighbridge or document APIs.

| Provider   | Notes |
|-----------|--------|
| **Car Track** | Distinct option from Cartrack where tenants use that product line. |
| **Cartrack** | Widely used; API access depends on account type. |
| **Ctrack** | MiX Telematics group; often separate API from “Mix Telematics” generic. |
| **FleetCam** | Camera/telematics combined stacks. |
| **Nestar / Netstar** | Same family; confirm tenant’s branding spelling. |
| **Tracker** | SA insurer-linked telematics; API varies by product. |
| **Bitrack** | Add when API docs / tenant credentials are available. |
| **Mix Telematics** | Enterprise MiX stack (may overlap naming with Ctrack). |
| **Geotab** | Global platform; REST/MyGeotab patterns. |
| **Custom (REST)** | Tenant-specific base URL + credentials. |

Use **`provider_type`** in `tracking_integration_provider` to select the connector implementation once background sync exists; until then, types are **labels** for configuration and reporting.

## Related app surfaces

- **Contractor** truck export / fields already include tracking provider names (Excel import maps Fleetcam, Cartrack, etc.).
- **Tracking & integration** UI lists the same provider types for new API connections.

See also: `npm run db:tracking-setup` for database objects used by this module.
