/**
 * Persist sign-in location (browser GPS + server IP). No third-party geolocation APIs.
 */
export async function insertUserLoginActivity(query, { tenantId, userId, ip, latitude, longitude, accuracyMeters, userAgent, source = 'login' }) {
  await query(
    `INSERT INTO user_login_activity (tenant_id, user_id, ip_address, latitude, longitude, accuracy_meters, user_agent, source)
     VALUES (@tid, @uid, @ip, @lat, @lng, @acc, @ua, @src)`,
    {
      tid: tenantId,
      uid: userId,
      ip: ip || null,
      lat: latitude,
      lng: longitude,
      acc: accuracyMeters != null ? accuracyMeters : null,
      ua: userAgent && String(userAgent).slice(0, 1000) || null,
      src: source,
    }
  );
}
